/*
 * wrapper-linux.c
 *
 * Originally sourced from:
 *   https://github.com/dainok/iou-web
 *
 * Copyright (C) the original authors of iou-web.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; version 2 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, see <https://www.gnu.org/licenses/>.
 *
 * NLC rewrite (2026). Same command line and telnet handshake as the original:
 *   wrapper-linux -m /path/to/image -p port [-t "Window Title"] [-d delay] [-P] -- [image options]
 *   -P allocates a pty for the child (interactive shells, e.g. podman exec -it); default is pipes (IOU).
 *
 * Differences from the original:
 *   - single poll() loop; IOU output is drained even without a console client and the
 *     last SCROLLBACK_MAX bytes are replayed to the next client (boot log stays visible)
 *   - block transfers instead of one byte per syscall, with a bounded output queue
 *   - proper telnet parsing (IAC IAC, WILL/WONT/DO/DONT, SB...SE), 0xFF escaped on output
 *   - one console session at a time; a second connection gets a "busy" line and is closed,
 *     dead sessions are reclaimed by TCP keepalive, SIGHUP still drops the current client
 *   - IOU is started with fork/execvp (no shell) in its own process group; SIGTERM/SIGINT to
 *     the wrapper stops IOU; the wrapper alone holds the console port. $PWD is re-exported
 *     before exec because IOU uses it (not getcwd) to find iourc.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <time.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/wait.h>

//--[ Telnet Commands ]--------------------------------------------------------
#define SE     240 // End of subnegotiation parameters
#define SB     250 // Sub-option to follow
#define WILL   251 // Will; request or confirm option begin
#define WONT   252 // Wont; deny option request
#define DO     253 // Do = Request or confirm remote option
#define DONT   254 // Don't = Demand or confirm option halt
#define IAC    255 // Interpret as Command
//--[ Telnet Options ]---------------------------------------------------------
#define BINARY   0 // Transmit Binary
#define ECHO     1 // Echo characters back to sender
#define SGA      3 // Suppress Go-Ahead

#define IO_CHUNK        4096
#define OUT_QUEUE_MAX   (256 * 1024)   // per-client pending output before we give up on it
#define SCROLLBACK_MAX  (32 * 1024)    // recent IOU output replayed to a newly connected client
#define KEEPALIVE_IDLE  30
#define KEEPALIVE_INTVL 10
#define KEEPALIVE_CNT   3
#define STOP_GRACE_SEC  5

static volatile sig_atomic_t g_hup = 0;
static volatile sig_atomic_t g_quit = 0;
static volatile sig_atomic_t g_child = 0;

static int g_port = 0;
static int g_pty = 0;   // -P: child gets a pty instead of pipes

static void on_signal(int sig)
{
	if (sig == SIGHUP) g_hup = 1;
	else if (sig == SIGCHLD) g_child = 1;
	else g_quit = 1;
}

static void logmsg(const char *fmt, ...)
{
	char ts[32];
	time_t now = time(NULL);
	va_list ap;
	strftime(ts, sizeof(ts), "%Y-%m-%d %H:%M:%S", localtime(&now));
	printf("%s ID_%d: ", ts, g_port);
	va_start(ap, fmt);
	vprintf(fmt, ap);
	va_end(ap);
	printf("\n");
}

static void usage(const char *prog)
{
	printf("Usage: %s -m /path/to/image -p port_number [-t \"Window Title\"] [-d delay] [-P] -- [image options]\n", prog);
	exit(1);
}

static int set_nonblock(int fd)
{
	int flags = fcntl(fd, F_GETFL, 0);
	return flags < 0 ? -1 : fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

static int open_listener(int port)
{
	struct sockaddr_in6 addr;
	int fd, on = 1, off = 0;

	fd = socket(AF_INET6, SOCK_STREAM, 0);
	if (fd < 0) {
		logmsg("error opening socket: %s", strerror(errno));
		return -1;
	}
	setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));
	setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &off, sizeof(off));
	memset(&addr, 0, sizeof(addr));
	addr.sin6_family = AF_INET6;
	addr.sin6_port = htons((unsigned short)port);
	addr.sin6_addr = in6addr_any;
	if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
		logmsg("error on binding, address already in use");
		close(fd);
		return -1;
	}
	if (listen(fd, 5) < 0) {
		logmsg("listen: %s", strerror(errno));
		close(fd);
		return -1;
	}
	set_nonblock(fd);
	return fd;
}

static void set_keepalive(int fd)
{
	int on = 1, idle = KEEPALIVE_IDLE, intvl = KEEPALIVE_INTVL, cnt = KEEPALIVE_CNT;
	setsockopt(fd, SOL_SOCKET, SO_KEEPALIVE, &on, sizeof(on));
	setsockopt(fd, IPPROTO_TCP, TCP_KEEPIDLE, &idle, sizeof(idle));
	setsockopt(fd, IPPROTO_TCP, TCP_KEEPINTVL, &intvl, sizeof(intvl));
	setsockopt(fd, IPPROTO_TCP, TCP_KEEPCNT, &cnt, sizeof(cnt));
	setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &on, sizeof(on));
}

/* ---- scrollback ring ---------------------------------------------------- */

static unsigned char sb_buf[SCROLLBACK_MAX];
static size_t sb_len = 0, sb_head = 0;   // head = index of the oldest byte once full

static void scrollback_add(const unsigned char *data, size_t len)
{
	size_t i;
	if (len >= SCROLLBACK_MAX) {
		data += len - SCROLLBACK_MAX;
		len = SCROLLBACK_MAX;
	}
	for (i = 0; i < len; i++) {
		size_t pos = (sb_head + sb_len) % SCROLLBACK_MAX;
		sb_buf[pos] = data[i];
		if (sb_len < SCROLLBACK_MAX) sb_len++;
		else sb_head = (sb_head + 1) % SCROLLBACK_MAX;
	}
}

/* ---- client output queue ------------------------------------------------ */

struct client {
	int fd;
	unsigned char *out;
	size_t out_len;
	size_t out_cap;
	int tstate;      // telnet parser state
	int cr;          // pty mode: previous forwarded byte was CR (swallow a trailing NUL/LF)
};

enum { T_DATA, T_IAC, T_OPT, T_SB, T_SB_IAC };

static int client_queue(struct client *c, const unsigned char *data, size_t len)
{
	if (c->out_len + len > OUT_QUEUE_MAX) return -1;
	if (c->out_len + len > c->out_cap) {
		size_t cap = c->out_cap ? c->out_cap : 16384;
		while (cap < c->out_len + len) cap *= 2;
		unsigned char *p = realloc(c->out, cap);
		if (!p) return -1;
		c->out = p;
		c->out_cap = cap;
	}
	memcpy(c->out + c->out_len, data, len);
	c->out_len += len;
	return 0;
}

/* returns -1 when the client is gone */
static int client_flush(struct client *c)
{
	while (c->out_len > 0) {
		ssize_t n = send(c->fd, c->out, c->out_len, MSG_NOSIGNAL);
		if (n < 0) {
			if (errno == EAGAIN || errno == EWOULDBLOCK) return 0;
			return -1;
		}
		memmove(c->out, c->out + n, c->out_len - (size_t)n);
		c->out_len -= (size_t)n;
	}
	return 0;
}

/* IOU output -> client, escaping 0xFF as IAC IAC (we negotiated BINARY) */
static int client_queue_escaped(struct client *c, const unsigned char *data, size_t len)
{
	size_t start = 0, i;
	static const unsigned char iac2[2] = { IAC, IAC };
	for (i = 0; i < len; i++) {
		if (data[i] == IAC) {
			if (client_queue(c, data + start, i - start + 1) < 0) return -1;
			if (client_queue(c, iac2, 1) < 0) return -1;
			start = i + 1;
		}
	}
	return client_queue(c, data + start, len - start);
}

static void client_close(struct client *c, const char *why)
{
	if (c->fd < 0) return;
	logmsg("client disconnected (%s)", why);
	close(c->fd);
	c->fd = -1;
	c->out_len = 0;
	c->tstate = T_DATA;
}

static void client_send_scrollback(struct client *c)
{
	size_t first = SCROLLBACK_MAX - sb_head;
	if (sb_len == 0) return;
	if (sb_len <= first) {
		client_queue_escaped(c, sb_buf + sb_head, sb_len);
	} else {
		client_queue_escaped(c, sb_buf + sb_head, first);
		client_queue_escaped(c, sb_buf, sb_len - first);
	}
}

static void client_send_banner(struct client *c, const char *title)
{
	static const unsigned char header[] = {
		IAC, WILL, ECHO,
		IAC, WILL, SGA,
		IAC, WILL, BINARY,
		IAC, DO, BINARY,
		'\033', ']', '0', ';'
	};
	static const unsigned char trailer[] = { '\007' };
	client_queue(c, header, sizeof(header));
	client_queue(c, (const unsigned char *)title, strlen(title));
	client_queue(c, trailer, sizeof(trailer));
}

/*
 * Feed bytes from the client through the telnet parser. Plain data goes to
 * the IOU stdin pipe; negotiation is consumed and ignored (the handshake we
 * send at connect time is all IOU needs).
 */
static void client_input(struct client *c, const unsigned char *in, size_t len, int to_iou)
{
	unsigned char data[IO_CHUNK];
	size_t n = 0, i;

	for (i = 0; i < len; i++) {
		unsigned char ch = in[i];
		switch (c->tstate) {
		case T_DATA:
			if (ch == IAC) c->tstate = T_IAC;
			else if (g_pty) {
				// Telnet Enter is CR-NUL or CR-LF; the pty line discipline
				// maps CR->NL, so drop the trailing NUL/LF to avoid a stray
				// char / blank line on the next prompt (what telnetd does).
				if (c->cr && (ch == '\0' || ch == '\n')) {
					c->cr = 0;
				} else {
					data[n++] = ch;
					c->cr = (ch == '\r');
				}
			}
			else data[n++] = ch;
			break;
		case T_IAC:
			if (ch == IAC) { data[n++] = IAC; c->tstate = T_DATA; }
			else if (ch == WILL || ch == WONT || ch == DO || ch == DONT) c->tstate = T_OPT;
			else if (ch == SB) c->tstate = T_SB;
			else c->tstate = T_DATA;      // two-byte command (NOP, AYT, ...)
			break;
		case T_OPT:
			c->tstate = T_DATA;           // option byte consumed
			break;
		case T_SB:
			if (ch == IAC) c->tstate = T_SB_IAC;
			break;
		case T_SB_IAC:
			if (ch == SE) c->tstate = T_DATA;
			else c->tstate = T_SB;        // IAC IAC inside subnegotiation, or stray byte
			break;
		}
	}
	if (n > 0 && to_iou >= 0) {
		size_t off = 0;
		while (off < n) {
			ssize_t w = write(to_iou, data + off, n - off);
			if (w <= 0) break;
			off += (size_t)w;
		}
	}
}

/* ---- child process ------------------------------------------------------ */

static pid_t start_image(const char *bin, char **args, int delay, int *to_child, int *from_child, int listen_fd)
{
	int in_pipe[2], out_pipe[2];
	pid_t pid;

	if (pipe(in_pipe) < 0 || pipe(out_pipe) < 0) {
		logmsg("pipe: %s", strerror(errno));
		return -1;
	}
	pid = fork();
	if (pid < 0) {
		logmsg("fork: %s", strerror(errno));
		return -1;
	}
	if (pid == 0) {
		setpgid(0, 0);                          // own process group so the wrapper can stop it as a unit
		signal(SIGHUP, SIG_DFL);
		signal(SIGINT, SIG_DFL);
		signal(SIGTERM, SIG_DFL);
		signal(SIGPIPE, SIG_DFL);
		signal(SIGCHLD, SIG_DFL);
		close(listen_fd);
		close(in_pipe[1]);
		close(out_pipe[0]);
		for (; delay > 0; delay--) {
			if (write(out_pipe[1], ".", 1) < 0) break;
			sleep(1);
		}
		dup2(in_pipe[0], STDIN_FILENO);
		dup2(out_pipe[1], STDOUT_FILENO);      // stderr stays on the wrapper log
		close(in_pipe[0]);
		close(out_pipe[1]);
		/* IOU locates iourc/NETMAP through $PWD, not getcwd(). The original wrapper
		 * went through sh, which re-exports PWD; do the same explicitly. */
		{
			char cwd[4096];
			if (getcwd(cwd, sizeof(cwd))) setenv("PWD", cwd, 1);
		}
		execvp(bin, args);
		fprintf(stderr, "exec %s: %s\n", bin, strerror(errno));
		_exit(127);
	}
	close(in_pipe[0]);
	close(out_pipe[1]);
	*to_child = in_pipe[1];
	*from_child = out_pipe[0];
	set_nonblock(*from_child);
	return pid;
}

static pid_t start_image_pty(const char *bin, char **args, int delay, int *master_out, int listen_fd)
{
	int master, slave;
	char sname[128];
	const char *p;
	pid_t pid;

	master = posix_openpt(O_RDWR | O_NOCTTY);
	if (master < 0 || grantpt(master) != 0 || unlockpt(master) != 0) {
		logmsg("openpt: %s", strerror(errno));
		if (master >= 0) close(master);
		return -1;
	}
	p = ptsname(master);
	if (!p) {
		logmsg("ptsname failed");
		close(master);
		return -1;
	}
	snprintf(sname, sizeof(sname), "%s", p);

	pid = fork();
	if (pid < 0) {
		logmsg("fork: %s", strerror(errno));
		close(master);
		return -1;
	}
	if (pid == 0) {
		signal(SIGHUP, SIG_DFL);
		signal(SIGINT, SIG_DFL);
		signal(SIGTERM, SIG_DFL);
		signal(SIGPIPE, SIG_DFL);
		signal(SIGCHLD, SIG_DFL);
		close(listen_fd);
		close(master);
		setsid();                              // new session + process group (pgid == pid, so stop_image can signal the group)
		slave = open(sname, O_RDWR);           // as session leader without O_NOCTTY -> this pty becomes our controlling terminal
		if (slave < 0) {
			fprintf(stderr, "open pts: %s\n", strerror(errno));
			_exit(127);
		}
		ioctl(slave, TIOCSCTTY, 0);            // belt and suspenders on kernels that need it explicitly
		for (; delay > 0; delay--) {
			if (write(slave, ".", 1) < 0) break;
			sleep(1);
		}
		dup2(slave, STDIN_FILENO);
		dup2(slave, STDOUT_FILENO);
		dup2(slave, STDERR_FILENO);            // shell prompt (stderr) reaches the client too
		if (slave > 2) close(slave);
		{
			char cwd[4096];
			if (getcwd(cwd, sizeof(cwd))) setenv("PWD", cwd, 1);
		}
		execvp(bin, args);
		fprintf(stderr, "exec %s: %s\n", bin, strerror(errno));
		_exit(127);
	}
	*master_out = master;                          // one bidirectional fd for both read and write
	set_nonblock(master);
	return pid;
}

static void stop_image(pid_t pid)
{
	int status, i;
	if (pid <= 0) return;
	kill(-pid, SIGTERM);
	for (i = 0; i < STOP_GRACE_SEC * 10; i++) {
		if (waitpid(pid, &status, WNOHANG) == pid) return;
		usleep(100000);
	}
	logmsg("subprocess ignored SIGTERM, sending SIGKILL");
	kill(-pid, SIGKILL);
	waitpid(pid, &status, 0);
}

/* ---- main --------------------------------------------------------------- */

int main(int argc, char *argv[])
{
	const char *xtitle = "Terminal Server", *bin = NULL;
	int c, delay = 0, listen_fd, to_child = -1, from_child = -1, child_eof = 0;
	int exit_code = 0;
	pid_t pid;
	struct client cl = { -1, NULL, 0, 0, T_DATA, 0 };
	struct sigaction sa;
	char **image_args;

	setvbuf(stdout, NULL, _IOLBF, 0);

	while ((c = getopt(argc, argv, ":m:p:t:d:P")) != -1) {
		switch (c) {
		case 'd': delay = atoi(optarg); break;
		case 'm': bin = optarg; break;
		case 'p': g_port = atoi(optarg); break;
		case 't': xtitle = optarg; break;
		case 'P': g_pty = 1; break;
		default: usage(argv[0]);
		}
	}
	if (!bin || g_port <= 1024 || g_port > 65535) {
		printf("ERR: -m image and -p port (1025..65535) are required.\n");
		usage(argv[0]);
	}
	if (access(bin, X_OK) == -1) {
		logmsg("file %s is not executable: %s", bin, strerror(errno));
		return 1;
	}

	/* exec argv: image path followed by everything after "--" */
	image_args = calloc((size_t)(argc - optind) + 2, sizeof(char *));
	image_args[0] = (char *)bin;
	for (c = optind; c < argc; c++) image_args[c - optind + 1] = argv[c];

	listen_fd = open_listener(g_port);
	if (listen_fd < 0) return 1;

	memset(&sa, 0, sizeof(sa));
	sa.sa_handler = on_signal;
	sigemptyset(&sa.sa_mask);
	sigaction(SIGHUP, &sa, NULL);
	sigaction(SIGINT, &sa, NULL);
	sigaction(SIGTERM, &sa, NULL);
	sigaction(SIGCHLD, &sa, NULL);
	signal(SIGPIPE, SIG_IGN);

	if (g_pty) {
		pid = start_image_pty(bin, image_args, delay, &to_child, listen_fd);
		from_child = to_child;   // pty master is one bidirectional fd
	} else {
		pid = start_image(bin, image_args, delay, &to_child, &from_child, listen_fd);
	}
	if (pid < 0) return 1;
	logmsg("started '%s' (pid %d) on port %d with title '%s'%s", bin, (int)pid, g_port, xtitle, g_pty ? " [pty]" : "");

	while (!g_quit) {
		struct pollfd pfd[3];
		int n = 0, i_listen, i_child = -1, i_client = -1, rc, status;

		if (g_child) {
			g_child = 0;
			if (waitpid(pid, &status, WNOHANG) == pid) {
				if (WIFEXITED(status)) {
					logmsg("subprocess exited with code %d", WEXITSTATUS(status));
					exit_code = WEXITSTATUS(status);
				} else {
					logmsg("subprocess terminated by signal %d", WIFSIGNALED(status) ? WTERMSIG(status) : 0);
					exit_code = 1;
				}
				pid = -1;
				break;
			}
		}
		if (g_hup) {
			g_hup = 0;
			logmsg("caught SIGHUP");
			client_close(&cl, "reset");
		}

		i_listen = n;
		pfd[n].fd = listen_fd;
		pfd[n++].events = POLLIN;
		if (!child_eof) {
			i_child = n;
			pfd[n].fd = from_child;
			pfd[n++].events = POLLIN;
		}
		if (cl.fd >= 0) {
			i_client = n;
			pfd[n].fd = cl.fd;
			pfd[n++].events = POLLIN | (cl.out_len > 0 ? POLLOUT : 0);
		}

		rc = poll(pfd, (nfds_t)n, 1000);
		if (rc < 0) {
			if (errno == EINTR) continue;
			logmsg("poll: %s", strerror(errno));
			break;
		}
		if (rc == 0) continue;

		/* IOU output */
		if (i_child >= 0 && (pfd[i_child].revents & (POLLIN | POLLHUP | POLLERR))) {
			unsigned char buf[IO_CHUNK];
			ssize_t len = read(from_child, buf, sizeof(buf));
			if (len > 0) {
				scrollback_add(buf, (size_t)len);
				if (cl.fd >= 0 && client_queue_escaped(&cl, buf, (size_t)len) < 0)
					client_close(&cl, "output queue overflow");
			} else if (len == 0 || (errno != EAGAIN && errno != EWOULDBLOCK)) {
				child_eof = 1;   // exit status is collected via SIGCHLD
			}
		}

		/* new connection */
		if (pfd[i_listen].revents & POLLIN) {
			struct sockaddr_in6 addr;
			socklen_t alen = sizeof(addr);
			int fd = accept(listen_fd, (struct sockaddr *)&addr, &alen);
			if (fd >= 0) {
				char ip[INET6_ADDRSTRLEN] = "?";
				inet_ntop(AF_INET6, &addr.sin6_addr, ip, sizeof(ip));
				if (cl.fd >= 0) {
					static const char busy[] = "\r\nConsole busy: another session is connected.\r\n";
					logmsg("client %s rejected: console busy", ip);
					send(fd, busy, sizeof(busy) - 1, MSG_NOSIGNAL);
					close(fd);
				} else {
					logmsg("client connected: %s", ip);
					cl.fd = fd;
					cl.tstate = T_DATA;
					set_nonblock(fd);
					set_keepalive(fd);
					client_send_banner(&cl, xtitle);
					client_send_scrollback(&cl);
				}
			}
		}

		/* client input / output */
		if (i_client >= 0 && cl.fd >= 0) {
			short ev = pfd[i_client].revents;
			if (ev & (POLLIN | POLLHUP | POLLERR)) {
				unsigned char buf[IO_CHUNK];
				ssize_t len = recv(cl.fd, buf, sizeof(buf), 0);
				if (len > 0) client_input(&cl, buf, (size_t)len, to_child);
				else if (len == 0) client_close(&cl, "closed by peer");
				else if (errno != EAGAIN && errno != EWOULDBLOCK) client_close(&cl, strerror(errno));
			}
		}
		if (cl.fd >= 0 && cl.out_len > 0 && client_flush(&cl) < 0)
			client_close(&cl, "send failed");
	}

	if (g_quit) logmsg("caught termination signal, stopping subprocess");
	client_close(&cl, "wrapper exiting");
	close(listen_fd);
	if (pid > 0) stop_image(pid);
	if (from_child >= 0 && from_child != to_child) close(from_child);
	if (to_child >= 0) close(to_child);
	free(cl.out);
	free(image_args);
	logmsg("exiting");
	return exit_code;
}
