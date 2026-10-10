"""
NETIO transport shared by the Python-simulated devices: IOU-style Unix-dgram
sockets at /tmp/netio<uid>/<instance>, the NETMAP adjacency file, and the
8-byte NETIO header in front of every Ethernet frame.
"""

import os
import re
import struct


def netio_dir():
    return f"/tmp/netio{os.getuid()}"

def netio_path(iid):
    return os.path.join(netio_dir(), str(iid))

def parse_netmap(path="NETMAP"):
    """Return list of (src_id, src_slot, src_port, dst_id, dst_slot, dst_port)."""
    result = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                m = re.fullmatch(r"(\d+):(\d+)/(\d+)\s+(\d+):(\d+)/(\d+)", line)
                if m:
                    result.append(tuple(int(x) for x in m.groups()))
    except OSError:
        pass
    return result

def netio_header(dst_id, src_id, dst_slot, dst_port, src_slot, src_port):
    dst_byte = ((dst_port & 0x0f) << 4) | (dst_slot & 0x0f)
    src_byte = ((src_port & 0x0f) << 4) | (src_slot & 0x0f)
    return struct.pack(">HHBBxx", dst_id, src_id, dst_byte, src_byte)


def peers_for(instance_id: int, connections: list) -> list:
    """Return [(peer_id, my_slot, my_port, peer_slot, peer_port), ...]."""
    peers = []
    for src_id, src_slot, src_port, dst_id, dst_slot, dst_port in connections:
        if src_id == instance_id:
            peers.append((dst_id, src_slot, src_port, dst_slot, dst_port))
        elif dst_id == instance_id:
            peers.append((src_id, dst_slot, dst_port, src_slot, src_port))
    return peers
