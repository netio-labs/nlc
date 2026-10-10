#include <sys/types.h>

// Get interface index of Ethernet device
int raw_get_dev_index(const char *name);

// Initialize an Ethernet raw socket
int raw_init_socket(int dev_id);

// Send an Ethernet frame to the Ethernet device
ssize_t raw_send(int socket, int dev_id, char *buffer, size_t len);

// Per-frame metadata reported by the kernel (PACKET_AUXDATA)
struct raw_rx_info {
	int csum_not_ready;   // L4 checksum left for hardware offload; must be fixed in software
	int vlan_reinserted;  // 802.1Q tag was stripped by rx offload and has been put back
};

// Receive an Ethernet frame from device. buffer must have room for a 4-byte VLAN tag.
ssize_t raw_recv(int socket, char *buffer, size_t len, struct raw_rx_info *info);


