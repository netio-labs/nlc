#ifndef IOULIVE_H
#define IOULIVE_H

#include <sys/un.h>

/* Runtime configuration shared between parse.c (setup) and ioulive.c (main loop). */
struct ioulive_cfg {
	const char *intf;          /* physical interface name */
	const char *title;         /* console window title */
	int raw_fd;                /* PF_PACKET socket bound to intf */
	int raw_dev_id;            /* ifindex of intf */
	int console_port;          /* TCP console port, 0 = disabled */
	int my_inst;               /* our IOU instance id */
	int peer_inst;             /* IOU instance we bridge */
	int peer_intf;             /* peer interface, IOU encoding: slot + port * 16 */
	char my_sock_path[sizeof(((struct sockaddr_un *)0)->sun_path)];
	char peer_sock_path[sizeof(((struct sockaddr_un *)0)->sun_path)];
};

int ioulive_main(const struct ioulive_cfg *cfg);

#endif
