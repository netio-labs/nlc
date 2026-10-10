/*
 * IOUlive86 front-end: command line parsing, NETMAP lookup, privilege handling.
 *
 * NLC build. Differences from upstream ioulive86:
 *   - getopt based parsing with -p <port> / -t <title> for the built-in console
 *   - raw socket is opened first, then privileges are dropped to SUDO_UID/SUDO_GID
 *     so the netio socket path (/tmp/netio<uid>) matches the IOU processes
 *   - NETMAP: our instance may appear on either side of a line
 */
#include <errno.h>
#include <grp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <linux/if.h>

#include "iou-raw.h"
#include "ioulive.h"

static void usage(const char *prog)
{
	fprintf(stderr,
		"Usage: %s -i <interface> [-n NETMAP] [-p <console port>] [-t <title>] <instance ID>\n",
		prog);
	exit(1);
}

/*
 * Find the NETMAP line that mentions our instance and return the peer.
 * Line format: "<inst>:<slot>/<port>[@host] <inst>[:<slot>/<port>][@host]".
 * Lines that do not parse (comments, blanks) are skipped.
 */
static int load_netmap(const char *path, int my_inst, int *peer_inst, int *peer_intf)
{
	FILE *fp = fopen(path, "r");
	char line[512], left[256], right[256];
	int found = 0;

	if (!fp) {
		fprintf(stderr, "Cannot open NETMAP %s: %s\n", path, strerror(errno));
		return -1;
	}

	while (!found && fgets(line, sizeof(line), fp)) {
		int li, ls, lp, ri, rs = 0, rp = 0;

		if (sscanf(line, "%255s %255s", left, right) != 2) continue;
		if (sscanf(left, "%d:%d/%d", &li, &ls, &lp) != 3) continue;
		if (sscanf(right, "%d:%d/%d", &ri, &rs, &rp) < 1) continue;

		if (ri == my_inst) {
			*peer_inst = li;
			*peer_intf = ls + lp * 16;
			found = 1;
		} else if (li == my_inst) {
			*peer_inst = ri;
			*peer_intf = rs + rp * 16;
			found = 1;
		}
	}
	fclose(fp);

	if (!found) {
		fprintf(stderr, "Check NETMAP %s: no line mentions instance %d\n", path, my_inst);
		return -1;
	}
	return 0;
}

/* When started via sudo, return to the invoking user once the raw socket is open. */
static void drop_privileges(void)
{
	const char *su = getenv("SUDO_UID");
	const char *sg = getenv("SUDO_GID");
	uid_t uid;
	gid_t gid;

	if (geteuid() != 0 || !su || !sg) return;

	uid = (uid_t)strtoul(su, NULL, 10);
	gid = (gid_t)strtoul(sg, NULL, 10);
	if (uid == 0) return;

	if (setgroups(0, NULL) != 0 || setgid(gid) != 0 || setuid(uid) != 0) {
		fprintf(stderr, "Cannot drop privileges to uid %u gid %u: %s\n",
			(unsigned)uid, (unsigned)gid, strerror(errno));
		exit(1);
	}
	/* setuid() clears the dumpable flag, which hides /proc/<pid>/fd from the
	 * unprivileged backend; fuser would then not see our console port. */
	prctl(PR_SET_DUMPABLE, 1, 0, 0, 0);
	printf("Dropped privileges to uid %u gid %u\n", (unsigned)uid, (unsigned)gid);
}

int main(int argc, char **argv)
{
	struct ioulive_cfg cfg;
	const char *netmap = "NETMAP";
	char netio_dir[64];
	int opt;

	memset(&cfg, 0, sizeof(cfg));
	cfg.title = "ioulive86";

	setvbuf(stdout, NULL, _IOLBF, 0);

	while ((opt = getopt(argc, argv, "i:n:p:t:h")) != -1) {
		switch (opt) {
		case 'i': cfg.intf = optarg; break;
		case 'n': netmap = optarg; break;
		case 'p': cfg.console_port = atoi(optarg); break;
		case 't': cfg.title = optarg; break;
		default: usage(argv[0]);
		}
	}
	if (!cfg.intf || optind != argc - 1) usage(argv[0]);
	cfg.my_inst = atoi(argv[optind]);
	if (cfg.my_inst <= 0 || cfg.my_inst > 1023) {
		fprintf(stderr, "Instance ID must be 1..1023\n");
		return 1;
	}
	if (strlen(cfg.intf) >= IFNAMSIZ) {
		fprintf(stderr, "Interface name too long: %s\n", cfg.intf);
		return 1;
	}
	if (cfg.console_port < 0 || cfg.console_port > 65535 ||
	    (cfg.console_port > 0 && cfg.console_port <= 1024)) {
		fprintf(stderr, "Console port must be in 1025..65535\n");
		return 1;
	}

	printf("IOUlive86 (NLC build), instance %d, interface %s\n", cfg.my_inst, cfg.intf);

	/* Raw socket first: this is the only step that needs CAP_NET_RAW. */
	cfg.raw_dev_id = raw_get_dev_index(cfg.intf);
	if (cfg.raw_dev_id < 0) {
		fprintf(stderr, "Invalid Ethernet device: %s\n", cfg.intf);
		return 1;
	}
	cfg.raw_fd = raw_init_socket(cfg.raw_dev_id);
	if (cfg.raw_fd < 0) {
		fprintf(stderr, "Cannot open raw socket on %s (need root or CAP_NET_RAW)\n", cfg.intf);
		return 1;
	}

	drop_privileges();

	if (load_netmap(netmap, cfg.my_inst, &cfg.peer_inst, &cfg.peer_intf) != 0) return 1;

	snprintf(netio_dir, sizeof(netio_dir), "/tmp/netio%u", (unsigned)getuid());
	if (mkdir(netio_dir, 0700) != 0 && errno != EEXIST) {
		fprintf(stderr, "Cannot create %s: %s\n", netio_dir, strerror(errno));
		return 1;
	}
	snprintf(cfg.my_sock_path, sizeof(cfg.my_sock_path), "%s/%d", netio_dir, cfg.my_inst);
	snprintf(cfg.peer_sock_path, sizeof(cfg.peer_sock_path), "%s/%d", netio_dir, cfg.peer_inst);

	printf("Bridging IOU instance %d interface %d/%d <-> %s (netio %s)\n",
	       cfg.peer_inst, cfg.peer_intf & 0x0f, cfg.peer_intf >> 4, cfg.intf, netio_dir);

	return ioulive_main(&cfg);
}
