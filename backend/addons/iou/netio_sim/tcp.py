"""Minimal client-side TCP over the VPC stack."""

import queue
import struct
import threading
import time

from .packets import ETHERTYPE_IP, PROTO_TCP, eth_frame, ip_header, tcp_segment

TCP_FIN, TCP_SYN, TCP_RST, TCP_PSH, TCP_ACK = 0x01, 0x02, 0x04, 0x08, 0x10
TCP_WIN = 8192
TCP_MSS = 1400

class TcpConn:
    """
    Client-side TCP over the VPC stack: handshake, in-order receive with
    cumulative ACK, retransmission of unacknowledged data, FIN/RST handling.
    Segments for our local port are pushed by VirtualPC._handle_tcp.
    """

    def __init__(self, pc, dst_mac: bytes, dst_ip: str, dst_port: int, sport: int):
        self.pc, self.dst_mac, self.dst_ip, self.dst_port, self.sport = pc, dst_mac, dst_ip, dst_port, sport
        self.q: queue.Queue = queue.Queue()
        self.snd_nxt = int(time.monotonic() * 1000) & 0xffffffff
        self.snd_una = self.snd_nxt
        self.rcv_nxt = 0
        self.state = "CLOSED"          # CLOSED, SYN_SENT, ESTABLISHED, FIN_WAIT, CLOSED_BY_PEER
        self.rx = bytearray()
        self.rx_event = threading.Event()
        self.unacked: list[tuple[int, bytes, float, int]] = []   # (seq, data, last_sent, tries)
        self.lock = threading.Lock()
        self.closed_reason = ""
        self._thread: threading.Thread | None = None

    # -- raw send --------------------------------------------------------------
    def _send(self, flags: int, seq: int, data: bytes = b""):
        seg = tcp_segment(self.pc.ip, self.dst_ip, self.sport, self.dst_port,
                       seq & 0xffffffff, self.rcv_nxt & 0xffffffff, flags, TCP_WIN, data)
        ip_h = ip_header(self.pc.ip, self.dst_ip, PROTO_TCP, len(seg))
        self.pc._send_frame(eth_frame(self.dst_mac, self.pc.my_mac, ETHERTYPE_IP, ip_h + seg))

    # -- connection setup --------------------------------------------------------
    def connect(self, timeout: float = 5.0) -> str | None:
        """Return None on success or an error message."""
        with self.pc._tcp_lock:
            self.pc._tcp_ports[self.sport] = self.q
        self.state = "SYN_SENT"
        deadline = time.monotonic() + timeout
        tries = 0
        last = 0.0   # time of the last SYN (retransmit every second)
        while time.monotonic() < deadline:
            if tries == 0 or time.monotonic() - last > 1.0:
                self._send(TCP_SYN, self.snd_nxt)
                last = time.monotonic()
                tries += 1
            seg = self._next_segment(0.2)
            if not seg:
                continue
            flags = seg[13]
            if flags & TCP_RST:
                self._release()
                return "Connection refused."
            if (flags & (TCP_SYN | TCP_ACK)) == (TCP_SYN | TCP_ACK):
                self.rcv_nxt = (struct.unpack(">I", seg[4:8])[0] + 1) & 0xffffffff
                self.snd_nxt = (self.snd_nxt + 1) & 0xffffffff
                self.snd_una = self.snd_nxt
                self.state = "ESTABLISHED"
                self._send(TCP_ACK, self.snd_nxt)
                self._thread = threading.Thread(target=self._run, daemon=True, name=f"tcp-{self.sport}")
                self._thread.start()
                return None
        self._release()
        return "Connection timed out."

    def _next_segment(self, timeout: float) -> bytes | None:
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            try:
                src_ip, pl = self.q.get(timeout=min(0.2, remaining))
            except queue.Empty:
                continue
            if src_ip == self.dst_ip and struct.unpack(">H", pl[0:2])[0] == self.dst_port:
                return pl

    # -- established-state engine ------------------------------------------------
    def _run(self):
        while self.state in ("ESTABLISHED", "FIN_WAIT"):
            seg = self._next_segment(0.2)
            now = time.monotonic()
            with self.lock:
                # retransmit oldest unacknowledged data
                if self.unacked:
                    seq, data, sent_at, tries = self.unacked[0]
                    if now - sent_at > 1.0:
                        if tries >= 5:
                            self._finish("Connection lost (no ACK).")
                            return
                        self._send(TCP_PSH | TCP_ACK, seq, data)
                        self.unacked[0] = (seq, data, now, tries + 1)
            if not seg:
                continue
            flags = seg[13]
            seg_seq = struct.unpack(">I", seg[4:8])[0]
            seg_ack = struct.unpack(">I", seg[8:12])[0]
            doff = (seg[12] >> 4) * 4
            data = seg[doff:]

            if flags & TCP_RST:
                self._finish("Connection reset by peer.")
                return
            if flags & TCP_ACK:
                with self.lock:
                    self.unacked = [u for u in self.unacked
                                    if ((seg_ack - (u[0] + len(u[1]))) & 0xffffffff) >= 0x80000000]
                    if ((seg_ack - self.snd_una) & 0xffffffff) < 0x80000000:
                        self.snd_una = seg_ack
            if data:
                if seg_seq == self.rcv_nxt:
                    self.rcv_nxt = (self.rcv_nxt + len(data)) & 0xffffffff
                    with self.lock:
                        self.rx += data
                    self.rx_event.set()
                    self._send(TCP_ACK, self.snd_nxt)
                elif ((self.rcv_nxt - seg_seq) & 0xffffffff) < 0x80000000:
                    self._send(TCP_ACK, self.snd_nxt)    # old duplicate: re-ACK
                # future segment (loss): wait for peer retransmission
            if flags & TCP_FIN and seg_seq == self.rcv_nxt:
                self.rcv_nxt = (self.rcv_nxt + 1) & 0xffffffff
                self._send(TCP_ACK, self.snd_nxt)
                if self.state == "ESTABLISHED":
                    self._send(TCP_FIN | TCP_ACK, self.snd_nxt)
                    self.snd_nxt = (self.snd_nxt + 1) & 0xffffffff
                self._finish("Connection closed by foreign host.")
                return

    def _finish(self, reason: str):
        self.closed_reason = reason
        self.state = "CLOSED_BY_PEER"
        self.rx_event.set()
        self._release()

    def _release(self):
        with self.pc._tcp_lock:
            self.pc._tcp_ports.pop(self.sport, None)

    # -- API ---------------------------------------------------------------------
    def send(self, data: bytes):
        if self.state != "ESTABLISHED":
            return
        for i in range(0, len(data), TCP_MSS):
            chunk = data[i:i + TCP_MSS]
            with self.lock:
                seq = self.snd_nxt
                self.snd_nxt = (self.snd_nxt + len(chunk)) & 0xffffffff
                self.unacked.append((seq, chunk, time.monotonic(), 1))
            self._send(TCP_PSH | TCP_ACK, seq, chunk)

    def recv(self, timeout: float = 0.2) -> bytes:
        """Return buffered data (possibly empty) after waiting up to timeout."""
        if not self.rx and self.state in ("ESTABLISHED", "FIN_WAIT"):
            self.rx_event.wait(timeout)
        with self.lock:
            data = bytes(self.rx)
            self.rx.clear()
            self.rx_event.clear()
        return data

    def recv_until(self, marker: bytes, timeout: float) -> bytes:
        buf = b""
        deadline = time.monotonic() + timeout
        while marker not in buf and time.monotonic() < deadline and not self.closed:
            buf += self.recv(0.3)
        return buf

    @property
    def closed(self) -> bool:
        return self.state in ("CLOSED", "CLOSED_BY_PEER")

    def close(self):
        if self.state == "ESTABLISHED":
            self._send(TCP_FIN | TCP_ACK, self.snd_nxt)
            self.snd_nxt = (self.snd_nxt + 1) & 0xffffffff
            self.state = "FIN_WAIT"
            t = self._thread
            if t:
                t.join(2.0)
        if self.state != "CLOSED_BY_PEER":
            self.state = "CLOSED"
        self._release()
