/*
 * IOUlive86 core: bridges one IOU instance to a physical Ethernet interface.
 *
 * NLC build. Single process, poll() driven, four descriptors:
 *   raw_fd       PF_PACKET socket on the physical interface
 *   netio_sock   our /tmp/netio<uid>/<inst> datagram socket (frames from IOU)
 *   listen_fd    optional TCP console listener (-p)
 *   client_fd    the one connected console client
 *
 * Frames towards IOU are sent with sendto() to the peer socket path, so no
 * connection state is kept: if the IOU process is not running the frame is
 * counted as dropped and the loop carries on. The console answers every
 * Enter with a one-screen status report, which also lets NLC reuse its
 * console-port based liveness, stop (SIGTERM) and reset (SIGHUP) handling.
 */
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <sys/un.h>

#include "iou-raw.h"
#include "ioulive.h"
#include "l4csum.h"

#define NETIO_HDR_LEN   8
#define FRAME_BUF_LEN   (NETIO_HDR_LEN + 16384)

/* telnet protocol bytes (same negotiation as wrapper-linux) */
#define IAC    255
#define DONT   254
#define DO     253
#define WONT   252
#define WILL   251
#define SB     250
#define SE     240
#define BINARY 0
#define ECHO   1
#define SGA    3

static volatile sig_atomic_t g_quit = 0;
static volatile sig_atomic_t g_hup = 0;

static void on_signal(int sig)
{
	if (sig == SIGHUP) g_hup = 1;
	else g_quit = 1;
}

static int set_nonblock(int fd)
{
	int flags = fcntl(fd, F_GETFL, 0);
	return flags < 0 ? -1 : fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

static int open_netio_socket(const char *path)
{
	struct sockaddr_un addr;
	int sock;

	unlink(path);
	sock = socket(AF_UNIX, SOCK_DGRAM, 0);
	if (sock < 0) {
		perror("netio socket");
		return -1;
	}
	memset(&addr, 0, sizeof(addr));
	addr.sun_family = AF_UNIX;
	snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", path);
	if (bind(sock, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
		perror("netio bind");
		close(sock);
		return -1;
	}
	return sock;
}

static int open_console_listener(int port)
{
	struct sockaddr_in6 addr;
	int fd, on = 1, off = 0;

	fd = socket(AF_INET6, SOCK_STREAM, 0);
	if (fd < 0) {
		perror("console socket");
		return -1;
	}
	setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));
	setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &off, sizeof(off));

	memset(&addr, 0, sizeof(addr));
	addr.sin6_family = AF_INET6;
	addr.sin6_port = htons((unsigned short)port);
	addr.sin6_addr = in6addr_any;
	if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
		fprintf(stderr, "console bind on port %d: %s\n", port, strerror(errno));
		close(fd);
		return -1;
	}
	if (listen(fd, 5) != 0) {
		perror("console listen");
		close(fd);
		return -1;
	}
	return fd;
}

static void console_write(int fd, const char *s, size_t len)
{
	while (len > 0) {
		ssize_t n = send(fd, s, len, MSG_NOSIGNAL);
		if (n <= 0) return;
		s += n;
		len -= (size_t)n;
	}
}

static void console_banner(int fd, const char *title)
{
	static const char header[] = {
		(char)IAC, (char)WILL, ECHO,
		(char)IAC, (char)WILL, SGA,
		(char)IAC, (char)WILL, BINARY,
		(char)IAC, (char)DO, BINARY,
		'\033', ']', '0', ';'
	};
	console_write(fd, header, sizeof(header));
	console_write(fd, title, strlen(title));
	console_write(fd, "\007", 1);
}

struct counters {
	unsigned long long lan_to_iou;
	unsigned long long iou_to_lan;
	unsigned long long dropped;
	unsigned long long raw_errors;
	unsigned long long csum_fixed;
	unsigned long long vlan_fixed;
};

static void console_status(int fd, const struct ioulive_cfg *cfg, const struct counters *c)
{
	char buf[512];
	int n = snprintf(buf, sizeof(buf),
		"\r\nioulive86 is working with physical interface %s\r\n"
		"  IOU instance %d %d/%d <-> ioulive86 instance %d (IOU socket %s)\r\n"
		"  frames LAN->IOU: %llu   IOU->LAN: %llu   dropped: %llu   raw errors: %llu\r\n"
		"  offload fixes: checksum %llu   vlan tag %llu\r\n",
		cfg->intf,
		cfg->peer_inst, cfg->peer_intf & 0x0f, cfg->peer_intf >> 4, cfg->my_inst,
		access(cfg->peer_sock_path, F_OK) == 0 ? "present" : "missing",
		c->lan_to_iou, c->iou_to_lan, c->dropped, c->raw_errors,
		c->csum_fixed, c->vlan_fixed);
	if (n > 0) console_write(fd, buf, (size_t)n);
}

int ioulive_main(const struct ioulive_cfg *cfg)
{
	struct sockaddr_un peer;
	struct sigaction sa;
	struct counters cnt = {0, 0, 0, 0, 0, 0};
	unsigned char frame[FRAME_BUF_LEN];   /* LAN -> IOU, header prefilled */
	unsigned char inbuf[FRAME_BUF_LEN];   /* IOU -> LAN */
	int netio_sock, listen_fd = -1, client_fd = -1;
	int iac_skip = 0;
	unsigned char last_ch = 0;

	memset(&peer, 0, sizeof(peer));
	peer.sun_family = AF_UNIX;
	snprintf(peer.sun_path, sizeof(peer.sun_path), "%s", cfg->peer_sock_path);

	netio_sock = open_netio_socket(cfg->my_sock_path);
	if (netio_sock < 0) return 1;

	if (cfg->console_port > 0) {
		listen_fd = open_console_listener(cfg->console_port);
		if (listen_fd < 0) {
			close(netio_sock);
			unlink(cfg->my_sock_path);
			return 1;
		}
		printf("Console listening on port %d\n", cfg->console_port);
	}

	set_nonblock(cfg->raw_fd);
	set_nonblock(netio_sock);
	if (listen_fd >= 0) set_nonblock(listen_fd);

	memset(&sa, 0, sizeof(sa));
	sa.sa_handler = on_signal;
	sigemptyset(&sa.sa_mask);
	sigaction(SIGHUP, &sa, NULL);
	sigaction(SIGINT, &sa, NULL);
	sigaction(SIGTERM, &sa, NULL);
	signal(SIGPIPE, SIG_IGN);

	/* netio header for frames we send to IOU: dst inst, src inst, dst intf, src intf, 1, 0 */
	frame[0] = (unsigned char)(cfg->peer_inst >> 8);
	frame[1] = (unsigned char)(cfg->peer_inst & 0xff);
	frame[2] = (unsigned char)(cfg->my_inst >> 8);
	frame[3] = (unsigned char)(cfg->my_inst & 0xff);
	frame[4] = (unsigned char)cfg->peer_intf;
	frame[5] = 0;
	frame[6] = 1;
	frame[7] = 0;

	printf("Ready\n");

	while (!g_quit) {
		struct pollfd pfd[4];
		int nfds = 0, i_raw, i_netio, i_listen = -1, i_client = -1;
		int rc;

		if (g_hup) {
			g_hup = 0;
			if (client_fd >= 0) {
				printf("SIGHUP: closing console client\n");
				close(client_fd);
				client_fd = -1;
			}
		}

		i_raw = nfds;
		pfd[nfds].fd = cfg->raw_fd;
		pfd[nfds++].events = POLLIN;
		i_netio = nfds;
		pfd[nfds].fd = netio_sock;
		pfd[nfds++].events = POLLIN;
		if (listen_fd >= 0) {
			i_listen = nfds;
			pfd[nfds].fd = listen_fd;
			pfd[nfds++].events = POLLIN;
		}
		if (client_fd >= 0) {
			i_client = nfds;
			pfd[nfds].fd = client_fd;
			pfd[nfds++].events = POLLIN;
		}

		rc = poll(pfd, (nfds_t)nfds, -1);
		if (rc < 0) {
			if (errno == EINTR) continue;
			perror("poll");
			break;
		}

		/* LAN -> IOU */
		if (pfd[i_raw].revents & POLLIN) {
			struct raw_rx_info rx;
			ssize_t len = raw_recv(cfg->raw_fd, (char *)frame + NETIO_HDR_LEN, sizeof(frame) - NETIO_HDR_LEN, &rx);
			if (len > 0) {
				if (rx.vlan_reinserted) cnt.vlan_fixed++;
				if (rx.csum_not_ready && l4csum_fix(frame + NETIO_HDR_LEN, (size_t)len)) cnt.csum_fixed++;
				if (sendto(netio_sock, frame, (size_t)len + NETIO_HDR_LEN, 0,
					   (struct sockaddr *)&peer, sizeof(peer)) < 0)
					cnt.dropped++;
				else
					cnt.lan_to_iou++;
			} else if (len < 0 && errno != EAGAIN && errno != EWOULDBLOCK) {
				cnt.raw_errors++;
			}
		}

		/* IOU -> LAN */
		if (pfd[i_netio].revents & POLLIN) {
			ssize_t len = recv(netio_sock, inbuf, sizeof(inbuf), 0);
			if (len > NETIO_HDR_LEN) {
				if (raw_send(cfg->raw_fd, cfg->raw_dev_id, (char *)inbuf + NETIO_HDR_LEN,
					     (size_t)len - NETIO_HDR_LEN) < 0)
					cnt.raw_errors++;
				else
					cnt.iou_to_lan++;
			}
		}

		/* console: new client */
		if (i_listen >= 0 && (pfd[i_listen].revents & POLLIN)) {
			struct sockaddr_in6 cli;
			socklen_t clilen = sizeof(cli);
			int fd = accept(listen_fd, (struct sockaddr *)&cli, &clilen);
			if (fd >= 0) {
				char ip[INET6_ADDRSTRLEN] = "?";
				inet_ntop(AF_INET6, &cli.sin6_addr, ip, sizeof(ip));
				if (client_fd >= 0) {
					/* one session at a time: never kick the current user */
					static const char busy[] = "\r\nConsole busy: another session is connected.\r\n";
					printf("Console client %s rejected: busy\n", ip);
					send(fd, busy, sizeof(busy) - 1, MSG_NOSIGNAL);
					close(fd);
				} else {
					int on = 1, idle = 30, intvl = 10, cnt_ka = 3;
					printf("Console client connected: %s\n", ip);
					client_fd = fd;
					set_nonblock(client_fd);
					setsockopt(client_fd, SOL_SOCKET, SO_KEEPALIVE, &on, sizeof(on));
					setsockopt(client_fd, IPPROTO_TCP, TCP_KEEPIDLE, &idle, sizeof(idle));
					setsockopt(client_fd, IPPROTO_TCP, TCP_KEEPINTVL, &intvl, sizeof(intvl));
					setsockopt(client_fd, IPPROTO_TCP, TCP_KEEPCNT, &cnt_ka, sizeof(cnt_ka));
					iac_skip = 0;
					last_ch = 0;
					console_banner(client_fd, cfg->title);
					console_status(client_fd, cfg, &cnt);
				}
			}
		}

		/* console: client input */
		if (i_client >= 0 && (pfd[i_client].revents & (POLLIN | POLLHUP | POLLERR))) {
			unsigned char in[256];
			ssize_t n = recv(client_fd, in, sizeof(in), 0);
			if (n <= 0) {
				if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) continue;
				printf("Console client disconnected\n");
				close(client_fd);
				client_fd = -1;
			} else {
				ssize_t k;
				for (k = 0; k < n; k++) {
					unsigned char ch = in[k];
					if (iac_skip > 0) {
						iac_skip--;
						continue;
					}
					if (ch == IAC) {
						iac_skip = 2;
						continue;
					}
					if (ch == '\r' || (ch == '\n' && last_ch != '\r'))
						console_status(client_fd, cfg, &cnt);
					last_ch = ch;
				}
			}
		}
	}

	printf("Exiting (LAN->IOU %llu, IOU->LAN %llu, dropped %llu)\n",
	       cnt.lan_to_iou, cnt.iou_to_lan, cnt.dropped);
	if (client_fd >= 0) close(client_fd);
	if (listen_fd >= 0) close(listen_fd);
	close(netio_sock);
	unlink(cfg->my_sock_path);
	close(cfg->raw_fd);
	return 0;
}
