"""
Placeholder IOU images (I86BI_LINUX-FAKE-*, I86BI_LINUX_L2-FAKE-*): a console
that shows a notice, plus a NETIO worker that binds the instance's socket and
periodically sends a gratuitous ARP to each NETMAP peer so links can be
captured. Accepts (and ignores) the standard IOU arguments from wrapper-linux.
"""

import os
import select
import signal
import socket
import struct
import sys
import threading

from .netio import netio_header, netio_path, parse_netmap, peers_for

NOTICE = (
    "                                                                    \r\n"
    "         00000011       11111  01111          01100000000000000010  \r\n"
    "         1000100010    10001  00000         100000100               \r\n"
    "        10000 000000  00000   10000       00000000                  \r\n"
    "       10001    10001010000  10001       01111100                   \r\n"
    "      00000      100000000  000000             0                    \r\n"
    "     000000       0000001  0000000111111111  01001111111111110      \r\n"
    "    000001          0000    0000000000000    000000000000000        \r\n"
    "\r\n"
    "  NLC NOTICE — PLACEHOLDER IMAGE 15.0\r\n"
    "\r\n"
    "  This is a placeholder (fake) {kind} image.\r\n"
    "  It provides console access ONLY and does NOT implement any\r\n"
    "  real networking functionality.\r\n"
    "\r\n"
    "  NLC is a free and open-source network lab orchestrator.\r\n"
    "  It does NOT include, distribute, or provide any IOU images.\r\n"
    "\r\n"
    "  All information and references used by NLC are sourced from\r\n"
    "  publicly available materials on the Internet.\r\n"
    "\r\n"
    "  To run actual network labs, you must supply your own IOU images\r\n"
    "  with proper authorization and licensing.\r\n"
    "\r\n"
    "  NLC assumes NO responsibility for how IOU software is obtained,\r\n"
    "  used, or distributed. Users are solely responsible for ensuring\r\n"
    "  compliance with applicable laws and license terms.\r\n"
    "\r\n"
    "  Type 'show' to display this notice again.\r\n"
    "\r\n"
)


def _arp_frame(instance_id: int) -> bytes:
    """
    Gratuitous ARP broadcast.
      Sender MAC : 02:00:00:00:{instance_id:02x}:00  (locally administered)
      Sender IP  : 10.0.{instance_id}.1
    """
    src_mac = bytes([0x02, 0x00, 0x00, 0x00, instance_id & 0xff, 0x00])
    bcast = b"\xff\xff\xff\xff\xff\xff"
    sender_ip = bytes([10, 0, instance_id & 0xff, 1])

    eth = bcast + src_mac + b"\x08\x06"   # EtherType = ARP
    arp = struct.pack(
        ">HHBBH6s4s6s4s",
        1,              # hardware type: Ethernet
        0x0800,         # protocol type: IPv4
        6, 4,           # hardware / protocol address size
        1,              # opcode: request
        src_mac, sender_ip,
        b"\x00" * 6, sender_ip,   # target MAC unknown; target IP = self (gratuitous)
    )
    return eth + arp


class NetioWorker:
    """
    Background daemon thread that:
      1. Binds a Unix-dgram socket at the NETIO path for this instance.
      2. Every `interval` seconds, parses NETMAP and sends one ARP frame
         to each connected peer so the capture proxy can intercept it.
    """

    def __init__(self, instance_id: int, interval: float = 5.0):
        self.instance_id = instance_id
        self.interval = interval
        self._sock: socket.socket | None = None
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._run, daemon=True, name="netio-worker"
        )

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        # Wake the sleeping wait() immediately.
        self._cleanup()

    # ------------------------------------------------------------------
    # Internal

    def _bind(self) -> bool:
        path = netio_path(self.instance_id)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        try:
            if os.path.exists(path):
                os.unlink(path)
        except OSError:
            pass
        try:
            s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
            s.bind(path)
            s.setblocking(False)
            self._sock = s
            return True
        except OSError:
            return False

    def _cleanup(self) -> None:
        s, self._sock = self._sock, None
        if s:
            try:
                s.close()
            except OSError:
                pass
        path = netio_path(self.instance_id)
        try:
            if os.path.exists(path):
                os.unlink(path)
        except OSError:
            pass

    def _send_to_peer(self, peer_id: int,
                      my_slot: int, my_port: int,
                      peer_slot: int, peer_port: int) -> None:
        if not self._sock:
            return
        header = netio_header(
            peer_id, self.instance_id,
            peer_slot, peer_port,
            my_slot, my_port,
        )
        dgram = header + _arp_frame(self.instance_id)
        peer_path = netio_path(peer_id)
        try:
            self._sock.sendto(dgram, peer_path)
        except OSError:
            pass  # peer not up yet, or mid-rename by capture proxy — skip silently

    def _run(self) -> None:
        if not self._bind():
            return
        # _stop.wait(interval) returns True when the event fires, False on timeout.
        while not self._stop.wait(self.interval):
            if not self._sock:
                break
            peers = peers_for(self.instance_id, parse_netmap())
            for peer in peers:
                self._send_to_peer(*peer)
        self._cleanup()


def main(kind: str) -> None:
    """kind: "router" or "switch" (notice text and prompt)."""
    notice = NOTICE.replace("{kind}", kind)
    prompt = f"fake-{kind}# "

    # Instance ID is the last positional argument passed by wrapper-linux.
    instance_id = int(sys.argv[-1]) if len(sys.argv) > 1 else 1
    worker = NetioWorker(instance_id)

    def shutdown(_signo, _frame):
        worker.stop()
        sys.stdout.write("\r\n")
        sys.stdout.flush()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    worker.start()

    sys.stdout.write(notice)
    sys.stdout.write(prompt)
    sys.stdout.flush()

    buf = ""

    def handle(ch: str) -> None:
        nonlocal buf
        if ch in ("\r", "\n"):
            sys.stdout.write("\r\n")
            cmd = buf.strip()
            buf = ""
            if cmd == "show":
                sys.stdout.write(notice)
            elif cmd:
                sys.stdout.write("  Unknown command: %s\r\n\r\n" % cmd)
            sys.stdout.write(prompt)
            sys.stdout.flush()
        elif ch in ("\x7f", "\x08"):  # backspace / delete
            if buf:
                buf = buf[:-1]
                sys.stdout.write("\b \b")
                sys.stdout.flush()
        elif ch == "\x03":  # Ctrl-C
            buf = ""
            sys.stdout.write("^C\r\n")
            sys.stdout.write(prompt)
            sys.stdout.flush()
        elif ch >= " ":  # printable
            buf += ch
            sys.stdout.write(ch)
            sys.stdout.flush()

    # Read the raw fd, not sys.stdin: sys.stdin.read(1) pulls every available
    # byte into Python's buffer, which select() can't see, so the rest of a
    # burst (e.g. the "\n" of a telnet "\r\n") waited there for the next key.
    stdin_fd = sys.stdin.fileno()
    prev = ""
    while True:
        try:
            r, _, _ = select.select([stdin_fd], [], [], 60)
        except (ValueError, OSError):
            break
        if not r:
            continue
        try:
            data = os.read(stdin_fd, 1024).decode("utf-8", errors="replace")
        except OSError:
            data = ""
        if not data:
            break
        for ch in data:
            if not (ch == "\n" and prev == "\r"):   # CR LF is one Enter
                handle(ch)
            prev = ch

    worker.stop()
