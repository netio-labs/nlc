#include <sys/types.h>
#include <stdio.h>
#include <string.h>
#include <stdarg.h>
#include <unistd.h>
#include <errno.h>
#include <signal.h>
#include <fcntl.h>
#include <ctype.h>
#include <netdb.h>
#include <sys/time.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <pthread.h>
#include <sys/ioctl.h>
#include <netinet/if_ether.h>
#include <linux/if.h>
#include <linux/if_packet.h>

#include "iou-raw.h"

// This file holds the functions that deal with low-level packet I/O

// Get interface index of Ethernet device
int raw_get_dev_index(const char *name)
{
	struct ifreq if_req;
	int fd;

	// Dummy fd
	if ((fd = socket(AF_INET, SOCK_STREAM, 0)) < 0) {
		fprintf(stderr, "raw_get_dev_index: socket: %s\n", strerror(errno));
		return (-1);
	}

	memset((void *) &if_req, 0, sizeof(if_req));
	strcpy(if_req.ifr_name, name);

	if (ioctl(fd, SIOCGIFINDEX, &if_req) < 0) {
		fprintf(stderr, "raw_get_dev_index: SIOCGIFINDEX: %s\n", strerror(errno));
		close(fd);
		return (-1);
	}

	close(fd);
	return (if_req.ifr_ifindex);
}

// Initialize an Ethernet raw socket
int raw_init_socket(int dev_id)
{
	struct sockaddr_ll sa;
	struct packet_mreq mreq;
	int sock;

	if ((sock = socket(PF_PACKET, SOCK_RAW, htons(ETH_P_ALL))) == -1) {
		fprintf(stderr, "raw_init_socket: socket: %s\n", strerror(errno));
		return (-1);
	}

	memset(&sa, 0, sizeof(struct sockaddr_ll));
	sa.sll_family = AF_PACKET;
	sa.sll_protocol = htons(ETH_P_ALL);
	sa.sll_hatype = ARPHRD_ETHER;
	sa.sll_halen = ETH_ALEN;
	sa.sll_ifindex = dev_id;

	memset(&mreq, 0, sizeof(mreq));
	mreq.mr_ifindex = sa.sll_ifindex;
	mreq.mr_type = PACKET_MR_PROMISC;

	if (bind(sock, (struct sockaddr *) &sa, sizeof(struct sockaddr_ll)) == -1) {
		fprintf(stderr, "raw_init_socket: bind: %s\n", strerror(errno));
		return (-1);
	}

	if (setsockopt(sock, SOL_PACKET, PACKET_ADD_MEMBERSHIP, &mreq, sizeof(mreq)) == -1) {
		fprintf(stderr, "raw_init_socket: setsockopt: %s\n", strerror(errno));
		return (-1);
	}

	// Ask for per-packet metadata: checksum-offload state and stripped VLAN tag
	int one = 1;
	if (setsockopt(sock, SOL_PACKET, PACKET_AUXDATA, &one, sizeof(one)) == -1) {
		fprintf(stderr, "raw_init_socket: PACKET_AUXDATA: %s\n", strerror(errno));
		return (-1);
	}

	return (sock);
}

// Send an Ethernet frame to the Ethernet device
ssize_t raw_send(int sock, int dev_id, char *buffer, size_t len)
{
	struct sockaddr_ll sa;

	memset(&sa, 0, sizeof(struct sockaddr_ll));
	sa.sll_family = AF_PACKET;
	sa.sll_protocol = htons(ETH_P_ALL);
	sa.sll_hatype = ARPHRD_ETHER;
	sa.sll_halen = ETH_ALEN;
	sa.sll_ifindex = dev_id;

	return( sendto(sock, buffer, len, 0, (struct sockaddr *) &sa, sizeof(sa)));
}

// Receive an Ethernet frame from device, with offload metadata
ssize_t raw_recv(int sock, char *buffer, size_t len, struct raw_rx_info *info)
{
	struct iovec iov = { buffer, len - 4 };	// keep room for a reinserted VLAN tag
	union {
		struct cmsghdr hdr;
		char buf[CMSG_SPACE(sizeof(struct tpacket_auxdata))];
	} control;
	struct msghdr msg;
	struct cmsghdr *cmsg;
	ssize_t n;

	memset(&msg, 0, sizeof(msg));
	msg.msg_iov = &iov;
	msg.msg_iovlen = 1;
	msg.msg_control = &control;
	msg.msg_controllen = sizeof(control);

	info->csum_not_ready = 0;
	info->vlan_reinserted = 0;

	n = recvmsg(sock, &msg, 0);
	if (n <= 0) return n;

	for (cmsg = CMSG_FIRSTHDR(&msg); cmsg; cmsg = CMSG_NXTHDR(&msg, cmsg)) {
		struct tpacket_auxdata aux;
		if (cmsg->cmsg_level != SOL_PACKET || cmsg->cmsg_type != PACKET_AUXDATA) continue;
		if (cmsg->cmsg_len < CMSG_LEN(sizeof(aux))) continue;
		memcpy(&aux, CMSG_DATA(cmsg), sizeof(aux));

		if (aux.tp_status & TP_STATUS_CSUMNOTREADY) info->csum_not_ready = 1;

		if ((aux.tp_status & TP_STATUS_VLAN_VALID) && n >= 12) {
			unsigned short tpid = (aux.tp_status & TP_STATUS_VLAN_TPID_VALID) ? aux.tp_vlan_tpid : 0x8100;
			memmove(buffer + 16, buffer + 12, (size_t)n - 12);
			buffer[12] = (char)(tpid >> 8);
			buffer[13] = (char)(tpid & 0xff);
			buffer[14] = (char)(aux.tp_vlan_tci >> 8);
			buffer[15] = (char)(aux.tp_vlan_tci & 0xff);
			n += 4;
			info->vlan_reinserted = 1;
		}
	}
	return n;
}



