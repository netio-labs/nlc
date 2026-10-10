"""
Virtual PC: a single-interface host with a pure-Python userspace stack over
NETIO (no root, no host interfaces). Stack, ARP, ping, configuration and
status live here; TCP applications in apps.py, DHCP in dhcp.py, the CLI in
vpc_cli.py.
"""

import os
import queue
import select
import socket
import struct
import sys
import threading
import time

from .apps import TcpAppsMixin
from .dhcp import DHCP_CLIENT_PORT, DhcpClient
from .netio import netio_dir, netio_header, netio_path, parse_netmap
from .packets import (BCAST_MAC, ETHERTYPE_ARP, ETHERTYPE_IP, PROTO_ICMP, PROTO_TCP, PROTO_UDP, arp_reply,
                      arp_request, eth_frame, icmp_echo_reply, icmp_echo_request, ip4, ip4s, ip_header, make_mac)


class VirtualPC(TcpAppsMixin):
    def __init__(self, instance_id):
        self.iid     = instance_id
        self.my_mac  = make_mac(instance_id)
        self.ip       = ""
        self.mask     = ""
        self.gateway  = ""
        self.hostname = "PC"

        self._sock = None

        # ARP cache: ip_str → mac_bytes
        self._arp_cache: dict[str, bytes] = {}
        self._arp_events: dict[str, threading.Event] = {}
        self._arp_lock = threading.Lock()

        # ICMP ping pending: (icmp_id, seq) → [Event, result_list]
        self._icmp_pending: dict[tuple, list] = {}
        self._icmp_lock = threading.Lock()

        # TCP port routing: local_port → Queue[(src_ip, payload_bytes)]
        self._tcp_ports: dict[int, queue.Queue] = {}
        self._tcp_lock = threading.Lock()

        # Web server state
        self._web_thread: threading.Thread | None = None
        self._web_stop   = threading.Event()
        self._web_port   = 80

        self._stop       = threading.Event()
        self._recv_thread = threading.Thread(
            target=self._recv_loop, daemon=True, name="netio-recv")

        self.dhcp = DhcpClient(self)

        # Console output from background threads (see notify). The CLI loop sets
        # busy while a command runs and prompt_hook to redraw prompt + input.
        self._out_lock = threading.Lock()
        self.busy = False
        self.prompt_hook = None

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self):
        os.makedirs(netio_dir(), exist_ok=True)
        path = netio_path(self.iid)
        if os.path.exists(path):
            os.unlink(path)
        s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        s.bind(path)
        s.setblocking(False)
        self._sock = s
        self._recv_thread.start()
        self.dhcp.start()

    def stop(self):
        self._stop.set()
        s, self._sock = self._sock, None
        if s:
            try: s.close()
            except OSError: pass
        path = netio_path(self.iid)
        try:
            if os.path.exists(path):
                os.unlink(path)
        except OSError:
            pass

    def notify(self, line: str):
        """Print a line from a background thread without mangling the input line:
        clear it, print, then redraw prompt + what the user had typed."""
        with self._out_lock:
            if self.busy or not self.prompt_hook:
                sys.stdout.write(line + "\r\n")
            else:
                sys.stdout.write("\r\x1b[K" + line + "\r\n" + self.prompt_hook())
            sys.stdout.flush()

    # ── NETIO send ────────────────────────────────────────────────────────────

    def _find_peer(self):
        """Scan NETMAP for the peer on eth0 (slot=0, port=0). Returns (peer_id, peer_slot, peer_port) or None."""
        for src_id, src_slot, src_port, dst_id, dst_slot, dst_port in parse_netmap():
            if src_id == self.iid and src_slot == 0 and src_port == 0:
                return dst_id, dst_slot, dst_port
            if dst_id == self.iid and dst_slot == 0 and dst_port == 0:
                return src_id, src_slot, src_port
        return None

    def _send_frame(self, frame: bytes):
        # Loopback: frames addressed to ourselves are dispatched locally.
        if len(frame) >= 6 and frame[0:6] == self.my_mac:
            self._dispatch(frame)
            return
        if not self._sock:
            return
        peer = self._find_peer()
        if not peer:
            return
        peer_id, peer_slot, peer_port = peer
        hdr = netio_header(peer_id, self.iid, peer_slot, peer_port, 0, 0)
        try:
            self._sock.sendto(hdr + frame, netio_path(peer_id))
        except OSError:
            pass

    # ── Receive loop ──────────────────────────────────────────────────────────

    def _recv_loop(self):
        while not self._stop.is_set():
            if not self._sock:
                break
            try:
                r, _, _ = select.select([self._sock], [], [], 0.5)
            except (ValueError, OSError):
                break
            if not r:
                continue
            try:
                data, _ = self._sock.recvfrom(65536)
            except OSError:
                continue
            if len(data) < 22:  # 8 NETIO + 14 Ethernet minimum
                continue
            self._dispatch(data[8:])

    def _dispatch(self, frame: bytes):
        if len(frame) < 14:
            return
        dst_mac = frame[0:6]
        src_mac = frame[6:12]
        etype   = struct.unpack(">H", frame[12:14])[0]
        payload = frame[14:]

        if dst_mac != self.my_mac and dst_mac != BCAST_MAC:
            return

        if etype == ETHERTYPE_ARP and len(payload) >= 28:
            self._handle_arp(src_mac, payload)
        elif etype == ETHERTYPE_IP and len(payload) >= 20:
            self._handle_ip(src_mac, payload)

    def _handle_arp(self, src_mac: bytes, payload: bytes):
        oper    = struct.unpack(">H", payload[6:8])[0]
        sha     = payload[8:14]
        spa     = payload[14:18]
        tpa     = payload[24:28]
        spa_str = ip4s(spa)
        tpa_str = ip4s(tpa)

        if spa_str != "0.0.0.0":
            self._arp_cache[spa_str] = sha
            with self._arp_lock:
                ev = self._arp_events.get(spa_str)
            if ev:
                ev.set()

        if oper == 1 and tpa_str == self.ip and self.ip:
            rep = arp_reply(self.my_mac, self.ip, sha, spa_str)
            self._send_frame(eth_frame(sha, self.my_mac, ETHERTYPE_ARP, rep))

    def _handle_ip(self, src_mac: bytes, payload: bytes):
        if len(payload) < 20:
            return
        ihl     = (payload[0] & 0x0f) * 4
        total   = struct.unpack(">H", payload[2:4])[0]
        proto   = payload[9]
        src_ip  = ip4s(payload[12:16])
        dst_ip  = ip4s(payload[16:20])

        if src_ip != "0.0.0.0":
            self._arp_cache[src_ip] = src_mac

        if len(payload) < ihl or total < ihl:
            return
        # Trim Ethernet padding: small frames are zero-padded to the 46-byte
        # minimum, and those bytes must not be mistaken for L4 payload
        # (a padded bare-ACK would otherwise look like 6 bytes of TCP data).
        body = payload[ihl:total]

        # DHCP replies may be unicast to the offered address before we own it.
        if proto == PROTO_UDP and len(body) >= 8 and struct.unpack(">H", body[2:4])[0] == DHCP_CLIENT_PORT:
            self.dhcp.handle(body[8:])
            return
        if dst_ip != self.ip and dst_ip != "255.255.255.255":
            return
        if proto == PROTO_ICMP and len(body) >= 8:
            self._handle_icmp(src_ip, body)
        elif proto == PROTO_TCP and len(body) >= 20:
            self._handle_tcp(src_ip, body)

    def _handle_icmp(self, src_ip: str, payload: bytes):
        icmp_type = payload[0]
        if icmp_type == 0:  # Echo Reply
            icmp_id, icmp_seq = struct.unpack(">HH", payload[4:8])
            key = (icmp_id, icmp_seq)
            with self._icmp_lock:
                entry = self._icmp_pending.get(key)
            if entry:
                ev, results = entry
                results.append((src_ip, time.monotonic()))
                ev.set()
        elif icmp_type == 8 and self.ip:  # Echo Request → reply
            icmp_id, icmp_seq = struct.unpack(">HH", payload[4:8])
            rep = icmp_echo_reply(icmp_id, icmp_seq, payload[8:])
            dst_mac = self._arp_cache.get(src_ip, BCAST_MAC)
            ip_h = ip_header(self.ip, src_ip, PROTO_ICMP, len(rep))
            self._send_frame(eth_frame(dst_mac, self.my_mac, ETHERTYPE_IP, ip_h + rep))

    def _handle_tcp(self, src_ip: str, payload: bytes):
        dport = struct.unpack(">H", payload[2:4])[0]
        with self._tcp_lock:
            q = self._tcp_ports.get(dport)
        if q:
            q.put((src_ip, payload))

    # ── ARP resolution ────────────────────────────────────────────────────────

    def _resolve(self, target_ip: str, timeout=3.0) -> bytes | None:
        """Resolve target_ip to MAC, sending ARP request if needed."""
        if target_ip == self.ip:
            return self.my_mac
        if target_ip in self._arp_cache:
            return self._arp_cache[target_ip]
        if not self.ip:
            return None
        ev = threading.Event()
        with self._arp_lock:
            self._arp_events[target_ip] = ev
        req = arp_request(self.my_mac, self.ip, target_ip)
        self._send_frame(eth_frame(BCAST_MAC, self.my_mac, ETHERTYPE_ARP, req))
        ev.wait(timeout)
        with self._arp_lock:
            self._arp_events.pop(target_ip, None)
        return self._arp_cache.get(target_ip)

    def _next_hop(self, dst_ip: str) -> str | None:
        """Return the IP to ARP for (on-link or gateway)."""
        if not self.ip or not self.mask:
            return None
        ip_i  = struct.unpack(">I", ip4(self.ip))[0]
        msk_i = struct.unpack(">I", ip4(self.mask))[0]
        dst_i = struct.unpack(">I", ip4(dst_ip))[0]
        if (ip_i & msk_i) == (dst_i & msk_i):
            return dst_ip
        if self.gateway:
            return self.gateway
        return None

    # ── Command: ping ─────────────────────────────────────────────────────────

    def cmd_ping(self, host: str, count: int = 5) -> str | None:
        if not self.ip:
            return "  IP address not configured."
        try:
            socket.inet_aton(host)
        except OSError:
            return f"  Invalid address: {host}"

        hop = self._next_hop(host)
        if not hop:
            return "  No route to host (configure ip gateway first)."

        dst_mac = self._resolve(hop)
        if not dst_mac:
            return f"  ARP timeout — {hop} unreachable."

        # Stream each reply as it arrives instead of returning everything at
        # the end, so the console shows one line per packet in real time.
        def emit(line: str) -> None:
            sys.stdout.write(line + "\r\n")
            sys.stdout.flush()

        emit(f"  Pinging {host}, {count} packets:")
        sent = received = 0
        rtts: list[float] = []
        icmp_id = self.iid & 0xffff
        ip_id = 1

        for seq in range(1, count + 1):
            ev = threading.Event()
            results: list = []
            key = (icmp_id, seq)
            with self._icmp_lock:
                self._icmp_pending[key] = [ev, results]

            pkt = icmp_echo_request(icmp_id, seq)
            ip_h = ip_header(self.ip, host, PROTO_ICMP, len(pkt), ip_id)
            t0 = time.monotonic()
            self._send_frame(eth_frame(dst_mac, self.my_mac, ETHERTYPE_IP, ip_h + pkt))
            sent += 1
            ip_id += 1

            ev.wait(2.0)
            with self._icmp_lock:
                self._icmp_pending.pop(key, None)

            if results:
                rtt = (results[0][1] - t0) * 1000
                rtts.append(rtt)
                received += 1
                emit(f"  Reply from {host}: seq={seq} time={rtt:.1f}ms")
            else:
                emit(f"  Request timeout for seq={seq}")

            if seq < count:
                time.sleep(0.5)

        loss = 100 * (sent - received) // sent if sent else 100
        emit(f"  --- {host}: {sent} sent, {received} received, {loss}% loss ---")
        if rtts:
            emit(f"  rtt min/avg/max = {min(rtts):.1f}/{sum(rtts)/len(rtts):.1f}/{max(rtts):.1f} ms")
        return None

    # ── configuration file ───────────────────────────────────────────────────

    CONFIG_FILE = "startup.cfg"

    def config_lines(self) -> list[str]:
        lines = [f"hostname {self.hostname}"]
        if self.dhcp.enabled:
            lines.append("ip address dhcp")  # address and gateway come from the server
        else:
            if self.ip and self.mask:
                lines.append(f"ip address {self.ip}/{self._mask_to_prefix()}")
            if self.gateway:
                lines.append(f"ip gateway {self.gateway}")
        if self._web_thread and self._web_thread.is_alive():
            lines.append(f"web start {self._web_port}")
        return lines

    def save_config(self) -> str:
        path = os.path.join(os.getcwd(), self.CONFIG_FILE)
        try:
            with open(path, "w") as f:
                f.write("\n".join(self.config_lines()) + "\n")
        except OSError as e:
            return f"  Cannot write {path}: {e}"
        return f"  Configuration saved to {path}"

    def load_config(self, run) -> str | None:
        """Replay startup.cfg through run(line), the CLI's command dispatcher."""
        path = os.path.join(os.getcwd(), self.CONFIG_FILE)
        try:
            with open(path) as f:
                lines = [l.strip() for l in f if l.strip() and not l.startswith("#")]
        except OSError:
            return None
        for line in lines:
            run(line)
        return f"  Loaded {len(lines)} line(s) from {self.CONFIG_FILE}"

    def show_config(self) -> str:
        path = os.path.join(os.getcwd(), self.CONFIG_FILE)
        try:
            with open(path) as f:
                saved = f.read().strip()
        except OSError:
            saved = "(no startup.cfg saved)"
        return ("  Running configuration:\r\n" + "\r\n".join("    " + l for l in self.config_lines())
                + "\r\n  Saved (startup.cfg):\r\n" + "\r\n".join("    " + l for l in saved.splitlines()))

    # ── show ─────────────────────────────────────────────────────────────────

    def _mask_to_prefix(self) -> int:
        n = struct.unpack(">I", ip4(self.mask))[0]
        return bin(n).count("1")

    def show_status(self) -> str:
        web_status = (f"running on port {self._web_port}"
                      if self._web_thread and self._web_thread.is_alive()
                      else "stopped")
        peer = self._find_peer()
        peer_str = f"connected to instance {peer[0]}" if peer else "not connected"
        source = " (DHCP)" if self.dhcp.bound else ""
        lines = [
            f"  Hostname  : {self.hostname}",
            f"  Interface : eth0 ({peer_str})",
            f"  MAC       : {':'.join(f'{b:02x}' for b in self.my_mac)}",
            f"  IP        : {self.ip or '(not set)'}"
            + (f"/{self._mask_to_prefix()}{source}" if self.ip and self.mask else ""),
            f"  Gateway   : {self.gateway or '(not set)'}" + (source if self.gateway else ""),
        ]
        if self.dhcp.enabled:
            lines += self.dhcp.status_lines()
        lines.append(f"  Web server: {web_status}")
        if self.dhcp.debug:
            lines.append("  Debug     : dhcp")
        return "\r\n".join(lines)
