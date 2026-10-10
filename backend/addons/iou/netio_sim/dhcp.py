"""DHCP client (RFC 2131) for the VPC's single interface."""

import queue
import random
import struct
import sys
import threading
import time

from .packets import BCAST_MAC, ETHERTYPE_IP, PROTO_UDP, eth_frame, ip4, ip4s, ip_header, udp_datagram

DHCP_SERVER_PORT, DHCP_CLIENT_PORT = 67, 68
DHCP_MAGIC = b"\x63\x82\x53\x63"
DHCPDISCOVER, DHCPOFFER, DHCPREQUEST, DHCPDECLINE, DHCPACK, DHCPNAK, DHCPRELEASE = 1, 2, 3, 4, 5, 6, 7
DHCP_TYPE_NAMES = {1: "DISCOVER", 2: "OFFER", 3: "REQUEST", 4: "DECLINE", 5: "ACK", 6: "NAK", 7: "RELEASE"}
# subnet mask, router, DNS, domain name, lease time, server id, T1, T2
DHCP_PARAM_REQUEST = bytes([1, 3, 6, 15, 51, 54, 58, 59])
DHCP_INFINITE = 0xffffffff
# Foreground exchanges: one retry per timeout (seconds).
DHCP_TRIES = (2, 3, 4)
# Background acquisition backs off up to this (seconds) between attempts.
DHCP_MAX_BACKOFF = 30


def _dhcp_options(raw: bytes) -> dict[int, bytes]:
    opts, i = {}, 0
    while i < len(raw):
        code = raw[i]
        if code == 255:
            break
        if code == 0:
            i += 1
            continue
        if i + 1 >= len(raw):
            break
        n = raw[i + 1]
        opts[code] = raw[i + 2:i + 2 + n]
        i += 2 + n
    return opts


def _dhcp_parse(body: bytes) -> dict | None:
    """Parse a BOOTP/DHCP reply; None if malformed or not DHCP."""
    if len(body) < 240 or body[0] != 2 or body[236:240] != DHCP_MAGIC:
        return None
    opts = _dhcp_options(body[240:])
    if 53 not in opts or len(opts[53]) != 1:
        return None
    ip_list = lambda b: [ip4s(b[i:i + 4]) for i in range(0, len(b) - 3, 4)]
    u32 = lambda b: struct.unpack(">I", b)[0] if len(b) == 4 else None
    return {
        "type": opts[53][0],
        "xid": struct.unpack(">I", body[4:8])[0],
        "yiaddr": ip4s(body[16:20]),
        "giaddr": ip4s(body[24:28]),
        "chaddr": body[28:34],
        "mask": ip4s(opts[1]) if len(opts.get(1, b"")) == 4 else "",
        "router": (ip_list(opts[3]) or [""])[0] if 3 in opts else "",
        "dns": ip_list(opts.get(6, b"")),
        "domain": opts.get(15, b"").rstrip(b"\x00").decode(errors="replace"),
        "server": ip4s(opts[54]) if len(opts.get(54, b"")) == 4 else "",
        "lease": u32(opts.get(51, b"")),
        "t1": u32(opts.get(58, b"")),
        "t2": u32(opts.get(59, b"")),
    }


def _classful_mask(ip: str) -> str:
    first = ip4(ip)[0]
    return "255.0.0.0" if first < 128 else "255.255.0.0" if first < 192 else "255.255.255.0"


def _fmt_secs(secs: float) -> str:
    secs = max(0, int(secs))
    d, rem = divmod(secs, 86400)
    h, rem = divmod(rem, 3600)
    m, s = divmod(rem, 60)
    return (f"{d}d " if d else "") + f"{h:02d}:{m:02d}:{s:02d}"


class DhcpClient:
    """
    DHCP client for eth0. States: DISABLED (static addressing), INIT (no lease,
    acquiring in the background), BOUND, RENEWING (unicast to the server after
    T1), REBINDING (broadcast after T2), RELEASED (DHCP mode, idle until the
    user asks). One exchange runs at a time; replies are matched by xid.

    Foreground commands report progress on the console; the background timer
    (renew/rebind/expiry, retrying acquisition) reports through pc.notify().
    """

    def __init__(self, pc):
        self.pc = pc
        self.state = "DISABLED"
        self.debug = False
        self.q: queue.Queue = queue.Queue()
        self._lock = threading.Lock()
        self._next_try = 0.0
        self._backoff = 2.0
        self._clear_lease()
        self._thread = threading.Thread(target=self._run, daemon=True, name="dhcp")

    def _clear_lease(self):
        self.server = self.relay = self.domain = ""
        self.dns: list[str] = []
        self.lease = 0
        self.bound_at = self.t1 = self.t2 = self.expiry = 0.0

    @property
    def enabled(self) -> bool:
        return self.state != "DISABLED"

    @property
    def bound(self) -> bool:
        return self.state in ("BOUND", "RENEWING", "REBINDING")

    def start(self):
        self._thread.start()

    @property
    def client_id(self) -> bytes:
        return b"\x01" + self.pc.my_mac

    # ── wire ──────────────────────────────────────────────────────────────────

    def _build(self, msg_type: int, xid: int, ciaddr="0.0.0.0", requested="", server="") -> bytes:
        broadcast = 0x8000 if ciaddr == "0.0.0.0" else 0   # can't take unicast before we have an address
        pkt = struct.pack(">BBBBIHH4s4s4s4s", 1, 1, 6, 0, xid, 0, broadcast,
                          ip4(ciaddr), b"\0" * 4, b"\0" * 4, b"\0" * 4)
        pkt += self.pc.my_mac + b"\0" * 10 + b"\0" * 192 + DHCP_MAGIC
        opts = bytes([53, 1, msg_type]) + bytes([61, len(self.client_id)]) + self.client_id
        name = self.pc.hostname.encode(errors="replace")[:63]
        if name and msg_type != DHCPRELEASE:
            opts += bytes([12, len(name)]) + name
        if requested:
            opts += bytes([50, 4]) + ip4(requested)
        if server:
            opts += bytes([54, 4]) + ip4(server)
        if msg_type in (DHCPDISCOVER, DHCPREQUEST):
            opts += bytes([55, len(DHCP_PARAM_REQUEST)]) + DHCP_PARAM_REQUEST
        pkt += opts + b"\xff"
        return pkt + b"\0" * max(0, 300 - len(pkt))    # BOOTP minimum size

    def _send(self, pkt: bytes, dst_ip="255.255.255.255", src_ip="0.0.0.0") -> bool:
        if dst_ip == "255.255.255.255":
            dst_mac = BCAST_MAC
        else:
            hop = self.pc._next_hop(dst_ip)
            dst_mac = self.pc._resolve(hop, 2.0) if hop else None
            if not dst_mac:
                self._log(f"no route/ARP to server {dst_ip}")
                return False
        udp = udp_datagram(src_ip, dst_ip, DHCP_CLIENT_PORT, DHCP_SERVER_PORT, pkt)
        ip_h = ip_header(src_ip, dst_ip, PROTO_UDP, len(udp))
        self.pc._send_frame(eth_frame(dst_mac, self.pc.my_mac, ETHERTYPE_IP, ip_h + udp))
        return True

    def handle(self, body: bytes):
        """UDP payload for port 68, from the receive thread."""
        msg = _dhcp_parse(body)
        if msg and msg["chaddr"] == self.pc.my_mac:
            self.q.put(msg)

    def _wait(self, xid: int, types: tuple, timeout: float) -> dict | None:
        deadline = time.monotonic() + timeout
        while (remaining := deadline - time.monotonic()) > 0:
            try:
                msg = self.q.get(timeout=min(0.2, remaining))
            except queue.Empty:
                continue
            if msg["xid"] == xid and msg["type"] in types:
                self._log_msg("recv", msg)
                return msg
        return None

    def _drain(self):
        while not self.q.empty():
            self.q.get_nowait()

    # ── debug / progress output ───────────────────────────────────────────────

    def _log(self, text: str):
        if self.debug:
            self.pc.notify(f"  [DHCP] {text}")

    def _log_msg(self, direction: str, msg: dict):
        if not self.debug:
            return
        name = DHCP_TYPE_NAMES.get(msg["type"], str(msg["type"]))
        text = f"{direction} {name:<8} xid=0x{msg['xid']:08x}"
        if msg["type"] in (DHCPOFFER, DHCPACK):
            text += f" {msg['yiaddr']}/{self._prefix(msg['mask'] or _classful_mask(msg['yiaddr']))}"
            if msg["router"]:
                text += f" gw {msg['router']}"
            if msg["lease"] is not None:
                text += " lease " + ("infinite" if msg["lease"] == DHCP_INFINITE else f"{msg['lease']}s")
        if msg["server"]:
            text += f" server {msg['server']}"
        if msg["giaddr"] != "0.0.0.0":
            text += f" via relay {msg['giaddr']}"
        self._log(text)

    def _log_sent(self, msg_type: int, xid: int, detail: str):
        self._log(f"send {DHCP_TYPE_NAMES[msg_type]:<8} xid=0x{xid:08x} {detail}".rstrip())

    @staticmethod
    def _prefix(mask: str) -> int:
        return bin(struct.unpack(">I", ip4(mask))[0]).count("1")

    # ── exchanges (caller holds self._lock) ───────────────────────────────────

    def _dora(self, progress=None, tries=DHCP_TRIES) -> tuple[dict | None, str]:
        """INIT → SELECTING → REQUESTING. Returns (ack, error)."""
        for _attempt in range(2):                     # one restart after a NAK
            xid = random.getrandbits(32)
            self._drain()
            offer = None
            for timeout in tries:
                requested = self.pc.ip if self.pc.ip and self.state != "DISABLED" else ""
                self._log_sent(DHCPDISCOVER, xid, "broadcast")
                self._send(self._build(DHCPDISCOVER, xid, requested=requested))
                if progress: progress("D")
                offer = self._wait(xid, (DHCPOFFER,), timeout)
                if offer:
                    break
            if not offer:
                return None, "Can't find dhcp server"
            if progress: progress("O")
            server = offer["server"]
            self._log_sent(DHCPREQUEST, xid, f"{offer['yiaddr']} server {server} (selecting)")
            self._send(self._build(DHCPREQUEST, xid, requested=offer["yiaddr"], server=server))
            if progress: progress("R")
            reply = self._wait(xid, (DHCPACK, DHCPNAK), tries[-1])
            if reply and reply["type"] == DHCPACK:
                if progress: progress("A")
                return reply, ""
            if reply is None:
                return None, "No ACK from dhcp server"
            if progress: progress("N")
        return None, "Request refused by dhcp server (NAK)"

    def _request_existing(self, broadcast: bool, timeout: float) -> dict | None:
        """RENEWING (unicast to the server) or REBINDING (broadcast) request."""
        xid = random.getrandbits(32)
        self._drain()
        self._log_sent(DHCPREQUEST, xid, f"{self.pc.ip} ({'rebinding' if broadcast else 'renewing'})")
        pkt = self._build(DHCPREQUEST, xid, ciaddr=self.pc.ip)
        if not self._send(pkt, "255.255.255.255" if broadcast else self.server, self.pc.ip):
            return None
        return self._wait(xid, (DHCPACK, DHCPNAK), timeout)

    def _apply(self, ack: dict):
        pc = self.pc
        if pc.ip != ack["yiaddr"]:
            pc._arp_cache.clear()
        pc.ip = ack["yiaddr"]
        pc.mask = ack["mask"] or _classful_mask(ack["yiaddr"])
        pc.gateway = ack["router"]
        self.server = ack["server"] or self.server
        self.relay = ack["giaddr"] if ack["giaddr"] != "0.0.0.0" else ""
        self.dns, self.domain = ack["dns"], ack["domain"]
        now = time.monotonic()
        self.lease = ack["lease"] if ack["lease"] is not None else DHCP_INFINITE
        self.bound_at = now
        if self.lease == DHCP_INFINITE:
            self.t1 = self.t2 = self.expiry = float("inf")
        else:
            self.expiry = now + self.lease
            self.t1 = now + (ack["t1"] if ack["t1"] is not None else self.lease * 0.5)
            self.t2 = now + (ack["t2"] if ack["t2"] is not None else self.lease * 0.875)
        self.state = "BOUND"
        self._backoff = 2.0

    def _drop(self):
        """Forget the lease and the address it gave us."""
        self.pc.ip = self.pc.mask = self.pc.gateway = ""
        self.pc._arp_cache.clear()
        self._clear_lease()

    def summary(self) -> str:
        return f"IP {self.pc.ip}/{self._prefix(self.pc.mask)}" + (f" GW {self.pc.gateway}" if self.pc.gateway else "")

    # ── commands (console thread) ─────────────────────────────────────────────

    def cmd_acquire(self) -> str:
        """ip address dhcp: switch to DHCP and run DORA now, VPCS-style progress."""
        out = sys.stdout
        def progress(ch):
            if not self.debug:
                out.write(ch); out.flush()
        if not self.debug:
            out.write("  "); out.flush()
        with self._lock:
            if self.state == "DISABLED":
                self.pc.ip = self.pc.mask = self.pc.gateway = ""
            ack, err = self._dora(progress)
            if ack:
                self._apply(ack)
                result = self.summary()
            elif self.bound:                            # re-run while holding a lease: keep it
                result = f"{err}; current lease kept."
            else:
                self._drop()
                self.state = "INIT"
                self._next_try = time.monotonic() + self._backoff
                result = f"{err}; will keep trying in the background."
        if self.debug:
            return "  " + result
        return " " + result if ack else "\r\n  " + result

    def cmd_renew(self) -> str:
        if not self.bound:
            return self.cmd_acquire()
        with self._lock:
            reply = None
            for timeout in DHCP_TRIES:
                reply = self._request_existing(False, timeout)
                if reply:
                    break
            if reply and reply["type"] == DHCPACK:
                self._apply(reply)
                return f"  Lease renewed: {self.summary()}, lease {self._lease_str()}"
            if reply:                                   # NAK: address no longer valid
                self._drop()
                self.state, self._next_try = "INIT", time.monotonic()
                return "  Renew refused by dhcp server (NAK); address removed, re-acquiring in the background."
            left = _fmt_secs(self.expiry - time.monotonic()) if self.expiry != float("inf") else "never"
            return f"  No reply from dhcp server {self.server}; current lease still valid (expires in {left})."

    def cmd_release(self) -> str:
        if not self.enabled:
            return "  DHCP is not enabled (static addressing)."
        with self._lock:
            if not self.bound:
                self.state = "RELEASED"
                return "  No DHCP lease to release."
            xid = random.getrandbits(32)
            ip, server = self.pc.ip, self.server
            self._log_sent(DHCPRELEASE, xid, f"{ip} server {server}")
            self._send(self._build(DHCPRELEASE, xid, ciaddr=ip, server=server), server, ip)
            self._drop()
            self.state = "RELEASED"
        return f"  Released {ip} to dhcp server {server}."

    def enable_background(self) -> str:
        """ip address dhcp from startup.cfg: acquire in the background (peers may still be booting)."""
        with self._lock:
            self.pc.ip = self.pc.mask = self.pc.gateway = ""
            self.state, self._next_try, self._backoff = "INIT", time.monotonic(), 2.0
        return "  DHCP enabled; acquiring an address in the background."

    def disable(self) -> bool:
        """Static IP configured: stop DHCP (the server's binding just times out)."""
        was = self.enabled
        with self._lock:
            self.state = "DISABLED"
            self._clear_lease()
        return was

    # ── timers (background thread) ────────────────────────────────────────────

    def _run(self):
        while not self.pc._stop.wait(0.5):
            if self.state in ("DISABLED", "RELEASED") or not self._lock.acquire(blocking=False):
                continue
            try:
                self._tick(time.monotonic())
            finally:
                self._lock.release()

    def _tick(self, now: float):
        if self.state == "INIT" and now >= self._next_try:
            ack, _ = self._dora(tries=(2,))
            if ack:
                self._apply(ack)
                self.pc.notify(f"  [DHCP] Obtained {self.summary()}")
            else:
                self._backoff = min(DHCP_MAX_BACKOFF, self._backoff * 2)
                self._next_try = time.monotonic() + self._backoff
            return
        if self.state == "BOUND" and now >= self.t1:
            self.state, self._next_try = "RENEWING", now
        if self.state == "RENEWING" and now >= self.t2:
            self.state, self._next_try = "REBINDING", now
            self._log("T2 reached, rebinding (broadcast)")
        if self.state in ("RENEWING", "REBINDING") and now >= self.expiry:
            ip = self.pc.ip
            self._drop()
            self.state, self._next_try = "INIT", now
            self.pc.notify(f"  [DHCP] Lease for {ip} expired; address removed, re-acquiring.")
            return
        if self.state in ("RENEWING", "REBINDING") and now >= self._next_try:
            rebinding = self.state == "REBINDING"
            # Never wait past T2 (renewing) / expiry (rebinding): the next phase must start on time.
            target = self.expiry if rebinding else self.t2
            reply = self._request_existing(rebinding, max(0.5, min(2.0, target - now)))
            if reply and reply["type"] == DHCPACK:
                self._apply(reply)
                self._log(f"lease {'rebound' if rebinding else 'renewed'}, {self._lease_str()}")
            elif reply:
                ip = self.pc.ip
                self._drop()
                self.state, self._next_try = "INIT", time.monotonic()
                self.pc.notify(f"  [DHCP] Server refused lease for {ip} (NAK); address removed, re-acquiring.")
            else:
                # RFC 2131 4.4.5: retry at half the time remaining to T2 / expiry
                # (not before 2s from now, not after the phase boundary itself).
                now = time.monotonic()
                self._next_try = min(target, now + max(2.0, (target - now) / 2))

    # ── show ──────────────────────────────────────────────────────────────────

    def _lease_str(self) -> str:
        if self.lease == DHCP_INFINITE:
            return "infinite"
        return f"{_fmt_secs(self.lease)}, expires in {_fmt_secs(self.expiry - time.monotonic())}"

    def status_lines(self) -> list[str]:
        cid = self.client_id.hex()
        cid = ".".join(cid[i:i + 4] for i in range(0, len(cid), 4))
        state = {"INIT": "acquiring", "BOUND": "bound", "RENEWING": "renewing",
                 "REBINDING": "rebinding", "RELEASED": "released"}[self.state]
        lines = [f"  DHCP      : {state}" + (f", server {self.server}" if self.bound and self.server else "")
                 + (f" via relay {self.relay}" if self.bound and self.relay else "")]
        if self.bound:
            lines.append(f"  Lease     : {self._lease_str()}")
            if self.lease != DHCP_INFINITE and self.state == "BOUND":
                lines[-1] += f" (renew in {_fmt_secs(self.t1 - time.monotonic())})"
            if self.dns:
                lines.append(f"  DNS       : {', '.join(self.dns)} (DHCP)")
            if self.domain:
                lines.append(f"  Domain    : {self.domain} (DHCP)")
        lines.append(f"  Client-ID : {cid}")
        return lines
