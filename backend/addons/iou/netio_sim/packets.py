"""Ethernet / ARP / IPv4 / ICMP / TCP / UDP frame builders for the VPC stack."""

import socket
import struct

ETHERTYPE_ARP = 0x0806
ETHERTYPE_IP  = 0x0800
BCAST_MAC     = b"\xff\xff\xff\xff\xff\xff"
PROTO_ICMP    = 1
PROTO_TCP     = 6
PROTO_UDP     = 17

def make_mac(iid):
    """Locally-administered MAC: 02:00:00:00:<iid>:01"""
    return bytes([0x02, 0x00, 0x00, 0x00, iid & 0xff, 0x01])

def ip4(s):  return socket.inet_aton(s)
def ip4s(b): return socket.inet_ntoa(b)

def prefix_to_mask(prefix):
    bits = (0xffffffff << (32 - int(prefix))) & 0xffffffff
    return ip4s(struct.pack(">I", bits))

def checksum(data):
    if len(data) % 2:
        data += b"\x00"
    s = sum(struct.unpack(f">{len(data)//2}H", data))
    while s >> 16:
        s = (s & 0xffff) + (s >> 16)
    return ~s & 0xffff

def eth_frame(dst, src, etype, payload):
    return dst + src + struct.pack(">H", etype) + payload

def arp_request(src_mac, src_ip, dst_ip):
    return struct.pack(">HHBBH6s4s6s4s",
        1, 0x0800, 6, 4, 1,
        src_mac, ip4(src_ip), b"\x00" * 6, ip4(dst_ip))

def arp_reply(src_mac, src_ip, dst_mac, dst_ip):
    return struct.pack(">HHBBH6s4s6s4s",
        1, 0x0800, 6, 4, 2,
        src_mac, ip4(src_ip), dst_mac, ip4(dst_ip))

def ip_header(src_ip, dst_ip, proto, payload_len, ip_id=1):
    h = struct.pack(">BBHHHBBH4s4s",
        0x45, 0, 20 + payload_len, ip_id, 0, 64, proto, 0,
        ip4(src_ip), ip4(dst_ip))
    return h[:10] + struct.pack(">H", checksum(h)) + h[12:]

def icmp_echo_request(icmp_id, seq, data=b"nlc-vpc "):
    raw = struct.pack(">BBHHH", 8, 0, 0, icmp_id, seq) + data
    return raw[:2] + struct.pack(">H", checksum(raw)) + raw[4:]

def icmp_echo_reply(icmp_id, seq, data=b""):
    raw = struct.pack(">BBHHH", 0, 0, 0, icmp_id, seq) + data
    return raw[:2] + struct.pack(">H", checksum(raw)) + raw[4:]

def tcp_segment(src_ip, dst_ip, sport, dport, seq, ack, flags, win, data=b""):
    """Build a TCP segment with checksum. flags: FIN=1 SYN=2 RST=4 PSH=8 ACK=16"""
    hdr = struct.pack(">HHIIHHHH",
        sport, dport, seq, ack, (5 << 12) | flags, win, 0, 0)
    seg = hdr + data
    pseudo = ip4(src_ip) + ip4(dst_ip) + struct.pack(">BBH", 0, 6, len(seg))
    csum = checksum(pseudo + seg)
    return seg[:16] + struct.pack(">H", csum) + seg[18:]

def udp_datagram(src_ip, dst_ip, sport, dport, data):
    """Build a UDP datagram with checksum (0 is sent as 0xffff, RFC 768)."""
    length = 8 + len(data)
    hdr = struct.pack(">HHHH", sport, dport, length, 0)
    pseudo = ip4(src_ip) + ip4(dst_ip) + struct.pack(">BBH", 0, PROTO_UDP, length)
    csum = checksum(pseudo + hdr + data) or 0xffff
    return hdr[:6] + struct.pack(">H", csum) + data
