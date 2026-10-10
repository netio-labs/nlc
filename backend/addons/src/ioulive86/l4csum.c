#include <string.h>
#include <arpa/inet.h>

#include "l4csum.h"

#define ETH_HLEN_       14
#define ETH_P_IP_       0x0800
#define ETH_P_IPV6_     0x86DD
#define ETH_P_8021Q_    0x8100
#define ETH_P_8021AD_   0x88A8
#define IPPROTO_TCP_    6
#define IPPROTO_UDP_    17

static unsigned long sum_bytes(const unsigned char *p, size_t len, unsigned long sum)
{
	while (len > 1) {
		sum += (unsigned long)((p[0] << 8) | p[1]);
		p += 2;
		len -= 2;
	}
	if (len) sum += (unsigned long)(p[0] << 8);
	return sum;
}

static unsigned short fold(unsigned long sum)
{
	while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
	return (unsigned short)~sum;
}

static int csum_offset(int proto)
{
	if (proto == IPPROTO_TCP_) return 16;
	if (proto == IPPROTO_UDP_) return 6;
	return -1;
}

/* pseudo header sum: addresses + zero/proto + L4 length */
static void write_l4(unsigned char *l4, size_t l4len, int proto, unsigned long pseudo)
{
	int off = csum_offset(proto);
	unsigned short csum;

	if (off < 0 || l4len < (size_t)off + 2) return;
	l4[off] = 0;
	l4[off + 1] = 0;
	pseudo += (unsigned long)proto;
	pseudo += (unsigned long)l4len;
	csum = fold(sum_bytes(l4, l4len, pseudo));
	if (proto == IPPROTO_UDP_ && csum == 0) csum = 0xffff;
	l4[off] = (unsigned char)(csum >> 8);
	l4[off + 1] = (unsigned char)(csum & 0xff);
}

int l4csum_fix(unsigned char *frame, size_t len)
{
	size_t off = ETH_HLEN_;
	unsigned int ethertype;

	if (len < ETH_HLEN_) return 0;
	ethertype = (frame[12] << 8) | frame[13];
	if (ethertype == ETH_P_8021Q_ || ethertype == ETH_P_8021AD_) {
		if (len < off + 4) return 0;
		ethertype = (frame[off + 2] << 8) | frame[off + 3];
		off += 4;
	}

	if (ethertype == ETH_P_IP_) {
		unsigned char *ip = frame + off;
		size_t ihl, total, l4len;
		int proto;

		if (len < off + 20 || (ip[0] >> 4) != 4) return 0;
		ihl = (size_t)(ip[0] & 0x0f) * 4;
		total = (size_t)((ip[2] << 8) | ip[3]);
		proto = ip[9];
		if (ihl < 20 || total < ihl || len < off + total) return 0;
		if (csum_offset(proto) < 0) return 0;
		if ((ip[6] & 0x1f) != 0 || (ip[6] & 0x20) != 0) return 0; /* fragment: leave alone */
		l4len = total - ihl;
		write_l4(ip + ihl, l4len, proto, sum_bytes(ip + 12, 8, 0));
		return 1;
	}

	if (ethertype == ETH_P_IPV6_) {
		unsigned char *ip6 = frame + off;
		size_t payload;
		int next;

		if (len < off + 40 || (ip6[0] >> 4) != 6) return 0;
		payload = (size_t)((ip6[4] << 8) | ip6[5]);
		next = ip6[6];
		if (csum_offset(next) < 0) return 0; /* extension headers not handled */
		if (len < off + 40 + payload) return 0;
		write_l4(ip6 + 40, payload, next, sum_bytes(ip6 + 8, 32, 0));
		return 1;
	}

	return 0;
}
