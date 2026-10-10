"""
TCP applications of the Virtual PC: telnet, ssh (version + algorithms), HTTP
GET and a tiny HTTP server. Mixed into VirtualPC, which provides the stack
(ip, _next_hop, _resolve, _send_frame, _tcp_ports, ...).
"""

import os
import queue
import re
import select
import socket
import struct
import sys
import threading
import time

from .packets import ETHERTYPE_IP, PROTO_TCP, eth_frame, ip_header, tcp_segment
from .tcp import TcpConn


class TcpAppsMixin:
    # ── TCP connect helper ───────────────────────────────────────────────────

    def _tcp_connect(self, host: str, port: int) -> tuple[TcpConn | None, str]:
        """Resolve, ARP and complete the TCP handshake. Returns (conn, error)."""
        try:
            socket.inet_aton(host)
        except OSError:
            return None, f"  Invalid address: {host}"
        if not self.ip:
            return None, "  IP address not configured."
        hop = self._next_hop(host)
        if not hop:
            return None, "  No route to host (configure ip gateway first)."
        dst_mac = self._resolve(hop)
        if not dst_mac:
            return None, f"  ARP timeout — {hop} unreachable."
        sport = 49152 + (int(time.monotonic() * 1000) % 16384)
        conn = TcpConn(self, dst_mac, host, port, sport)
        err = conn.connect()
        if err:
            return None, "  " + err
        return conn, ""

    # ── Command: telnet ──────────────────────────────────────────────────────

    def cmd_telnet(self, host: str, port: int, stdin_fd: int) -> str:
        conn, err = self._tcp_connect(host, port)
        if not conn:
            return err
        out = sys.stdout
        out.write(f"  Trying {host}:{port}... connected.\r\n  Escape character is Ctrl-].\r\n")
        out.flush()

        # telnet option parser state for the server -> client stream
        st = {"mode": 0, "cmd": 0}
        def from_server(data: bytes) -> bytes:
            shown = bytearray(); reply = bytearray()
            for b in data:
                m = st["mode"]
                if m == 0:
                    if b == 255: st["mode"] = 1
                    else: shown.append(b)
                elif m == 1:
                    if b == 255: shown.append(255); st["mode"] = 0
                    elif b in (251, 252, 253, 254): st["cmd"] = b; st["mode"] = 2
                    elif b == 250: st["mode"] = 3
                    else: st["mode"] = 0
                elif m == 2:
                    cmd = st["cmd"]; st["mode"] = 0
                    if cmd == 251:   # WILL opt -> DO for ECHO/SGA, else DONT
                        reply += bytes([255, 253 if b in (1, 3) else 254, b])
                    elif cmd == 253: # DO opt -> WONT
                        reply += bytes([255, 252, b])
                    # WONT / DONT need no answer
                elif m == 3:
                    if b == 255: st["mode"] = 4
                elif m == 4:
                    st["mode"] = 0 if b == 240 else 3
            if reply:
                conn.send(bytes(reply))
            return bytes(shown)

        def pump():
            while not conn.closed:
                data = conn.recv(0.2)
                if data:
                    out.buffer.write(from_server(data)); out.flush()
        t = threading.Thread(target=pump, daemon=True); t.start()

        reason = ""
        while True:
            if conn.closed:
                reason = conn.closed_reason
                break
            r, _, _ = select.select([stdin_fd], [], [], 0.1)
            if not r:
                continue
            try:
                raw = os.read(stdin_fd, 256)
            except OSError:
                raw = b""
            if not raw:
                break
            if b"\x1d" in raw:            # Ctrl-]
                conn.close()
                reason = "Connection closed."
                break
            conn.send(raw.replace(b"\xff", b"\xff\xff").replace(b"\r", b"\r\x00"))
        t.join(1.0)
        return f"\r\n  {reason}"

    # ── Command: ssh (version + server KEXINIT algorithms) ───────────────────

    @staticmethod
    def _ssh_namelist(items: str) -> bytes:
        b = items.encode()
        return struct.pack(">I", len(b)) + b

    def _ssh_kexinit_payload(self) -> bytes:
        cookie = os.urandom(16)
        lists = [
            "diffie-hellman-group14-sha1,diffie-hellman-group1-sha1",   # kex
            "ssh-rsa",                                                   # host key
            "aes128-ctr,aes128-cbc,3des-cbc",                           # cipher c->s
            "aes128-ctr,aes128-cbc,3des-cbc",                           # cipher s->c
            "hmac-sha1,hmac-md5",                                       # mac c->s
            "hmac-sha1,hmac-md5",                                       # mac s->c
            "none",                                                     # compress c->s
            "none",                                                     # compress s->c
            "",                                                         # lang c->s
            "",                                                         # lang s->c
        ]
        body = bytes([20]) + cookie
        for l in lists:
            body += self._ssh_namelist(l)
        body += bytes([0]) + struct.pack(">I", 0)   # first_kex_packet_follows, reserved
        return body

    @staticmethod
    def _ssh_wrap(payload: bytes) -> bytes:
        # SSH binary packet, no encryption: length | pad_len | payload | padding
        block = 8
        pad = block - ((5 + len(payload)) % block)
        if pad < 4:
            pad += block
        pkt_len = 1 + len(payload) + pad
        return struct.pack(">I", pkt_len) + bytes([pad]) + payload + (b"\x00" * pad)

    @staticmethod
    def _ssh_parse_kexinit(payload: bytes) -> list[str] | None:
        if not payload or payload[0] != 20 or len(payload) < 17:
            return None
        off = 17  # msg type + 16-byte cookie
        names = []
        for _ in range(10):
            if off + 4 > len(payload):
                return None
            n = struct.unpack(">I", payload[off:off + 4])[0]
            off += 4
            names.append(payload[off:off + n].decode(errors="replace"))
            off += n
        return names

    def cmd_ssh(self, host: str, port: int) -> str:
        conn, err = self._tcp_connect(host, port)
        if not conn:
            return err
        try:
            conn.send(b"SSH-2.0-NLC_VirtualPC_1.0\r\n")
            buf = conn.recv_until(b"\n", 5.0)
            idx = buf.find(b"SSH-")
            if idx < 0:
                tail = f" ({conn.closed_reason})" if conn.closed_reason else ""
                return "  No SSH identification received." + tail
            eol = buf.find(b"\n", idx)
            version = buf[idx:eol if eol >= 0 else len(buf)].rstrip(b"\r").decode(errors="replace")
            rest = buf[eol + 1:] if eol >= 0 else b""

            # Send our KEXINIT so the server replies with its own.
            conn.send(self._ssh_wrap(self._ssh_kexinit_payload()))

            # Read a full binary packet: uint32 length, then that many bytes.
            deadline = time.monotonic() + 5.0
            while len(rest) < 4 and time.monotonic() < deadline and not conn.closed:
                rest += conn.recv(0.3)
            if len(rest) < 4:
                return f"  Server version : {version}\r\n  (no KEXINIT received)"
            plen = struct.unpack(">I", rest[:4])[0]
            if plen > 35000:
                return f"  Server version : {version}\r\n  (invalid KEXINIT length)"
            while len(rest) < 4 + plen and time.monotonic() < deadline and not conn.closed:
                rest += conn.recv(0.3)
            if len(rest) < 4 + plen:
                return f"  Server version : {version}\r\n  (KEXINIT truncated)"
            pad = rest[4]
            payload = rest[5:4 + plen - pad]
            names = self._ssh_parse_kexinit(payload)
            if not names:
                first = payload[0] if payload else "?"
                return f"  Server version : {version}\r\n  (unexpected packet type {first})"

            labels = ["Key exchange", "Host key", "Cipher c->s", "Cipher s->c",
                      "MAC c->s", "MAC s->c", "Compression c->s", "Compression s->c",
                      "Languages c->s", "Languages s->c"]
            lines = [f"  Server version : {version}"]
            for lab, val in zip(labels, names):
                if lab.startswith("Languages") and not val:
                    continue
                lines.append(f"  {lab:<16}: {val or '(none)'}")
            return "\r\n".join(lines)
        finally:
            conn.close()

    # ── Command: get ──────────────────────────────────────────────────────────
    # ── Command: get ──────────────────────────────────────────────────────────

    def cmd_get(self, url: str) -> str:
        m = re.match(r"(?:http://)?([^/:]+)(?::(\d+))?/?$", url)
        if not m:
            return "  Usage: get http://<host>[:<port>]"
        host = m.group(1)
        port = int(m.group(2) or 80)
        path = "/"

        conn, err = self._tcp_connect(host, port)
        if not conn:
            return err
        try:
            conn.send(f"GET {path} HTTP/1.0\r\nHost: {host}\r\nConnection: close\r\n\r\n".encode())
            parts = b""
            deadline = time.monotonic() + 10.0
            while time.monotonic() < deadline:
                data = conn.recv(0.5)
                parts += data
                if conn.closed and not data:
                    break
            if not parts:
                return "  No response received." + (f" ({conn.closed_reason})" if conn.closed_reason else "")
            body = parts.decode(errors="replace")
            if len(body) > 2048:
                body = body[:2048] + "\r\n  ... (truncated)"
            return body
        finally:
            conn.close()

    # ── Command: web start / stop ─────────────────────────────────────────────

    def _web_response(self) -> bytes:
        body = f"NLC Virtual PC Web Service - {self.hostname}\r\n".encode()
        header = (
            b"HTTP/1.0 200 OK\r\n"
            b"Content-Type: text/plain\r\n"
            + f"Content-Length: {len(body)}\r\n".encode()
            + b"Connection: close\r\n"
            b"\r\n"
        )
        return header + body

    def cmd_web_start(self, port: int = 80) -> str:
        if self._web_thread and self._web_thread.is_alive():
            return f"  Web server already running on port {self._web_port}."
        if not self.ip:
            return "  IP address not configured."
        self._web_port = port
        self._web_stop.clear()
        self._web_thread = threading.Thread(
            target=self._web_serve, daemon=True, name="web-server")
        self._web_thread.start()
        return f"  Web server started on port {port}."

    def cmd_web_stop(self) -> str:
        if not self._web_thread or not self._web_thread.is_alive():
            return "  Web server is not running."
        self._web_stop.set()
        return "  Web server stopped."

    def _web_serve(self):
        web_q: queue.Queue = queue.Queue()
        with self._tcp_lock:
            self._tcp_ports[self._web_port] = web_q
        try:
            while not self._web_stop.is_set():
                try:
                    src_ip, pl = web_q.get(timeout=0.5)
                except queue.Empty:
                    continue
                if pl[13] & 0x02:  # SYN
                    self._web_handle(src_ip, pl, web_q)
        finally:
            with self._tcp_lock:
                self._tcp_ports.pop(self._web_port, None)

    def _web_handle(self, src_ip: str, syn: bytes, web_q: queue.Queue):
        if not self.ip:
            return
        dst_mac = self._arp_cache.get(src_ip)
        if not dst_mac:
            return

        client_sport = struct.unpack(">H", syn[0:2])[0]
        peer_seq     = struct.unpack(">I", syn[4:8])[0]
        my_seq       = int(time.monotonic() * 1000) & 0xffffffff
        dport        = self._web_port

        def send(flags, seq, ack, data=b""):
            seg = tcp_segment(self.ip, src_ip, dport, client_sport, seq, ack, flags, 8192, data)
            ip_h = ip_header(self.ip, src_ip, PROTO_TCP, len(seg))
            self._send_frame(eth_frame(dst_mac, self.my_mac, ETHERTYPE_IP, ip_h + seg))

        # SYN-ACK
        send(0x12, my_seq, peer_seq + 1)
        my_seq += 1
        peer_next = peer_seq + 1

        # Receive ACK + HTTP request
        req_buf = b""
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline and not self._web_stop.is_set():
            try:
                s_ip, pl = web_q.get(timeout=0.3)
            except queue.Empty:
                continue
            if s_ip != src_ip:
                continue
            if struct.unpack(">H", pl[0:2])[0] != client_sport:
                continue
            if pl[13] & 0x04:  # RST
                return
            doff = (pl[12] >> 4) * 4
            chunk = pl[doff:]
            if chunk:
                req_buf += chunk
                peer_next = struct.unpack(">I", pl[4:8])[0] + len(chunk)
                if b"\r\n\r\n" in req_buf:
                    break

        if not req_buf:
            return

        # Send response
        response = self._web_response()
        send(0x18, my_seq, peer_next, response)
        my_seq += len(response)
        time.sleep(0.05)
        send(0x11, my_seq, peer_next)  # FIN+ACK
