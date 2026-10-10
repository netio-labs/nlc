"""Virtual PC command line: help text, command dispatch and entry point."""

import signal
import socket
import struct
import sys

from .console import run_console
from .packets import prefix_to_mask
from .vpc import VirtualPC


HELP = (
    "  ip address <A.B.C.D>/<nn>     set IP (e.g. ip address 192.168.1.10/24)\r\n"
    "  ip address <A.B.C.D> <mask>   set IP (e.g. ip address 192.168.1.10 255.255.255.0)\r\n"
    "  ip address dhcp               get IP/mask/gateway from a DHCP server\r\n"
    "  ip gateway <A.B.C.D>          set default gateway\r\n"
    "  renew dhcp                    renew the DHCP lease\r\n"
    "  release dhcp                  release the DHCP lease\r\n"
    "  hostname <name>               set hostname (changes prompt)\r\n"
    "  show                          show current status\r\n"
    "  show config                   show running vs saved startup.cfg\r\n"
    "  ping <host> [<count>]         ICMP echo (default 5)\r\n"
    "  telnet <host> [<port>]        telnet session (Ctrl-] to disconnect)\r\n"
    "  ssh <host> [<port>]           show SSH server version and algorithms\r\n"
    "  get http://<host>[:<port>]    HTTP GET\r\n"
    "  web start [<port>]            start HTTP server (default 80)\r\n"
    "  web stop                      stop HTTP server\r\n"
    "  save | write                  save configuration to startup.cfg\r\n"
    "  debug dhcp | no debug dhcp    show DHCP messages as they are sent/received\r\n"
    "  help | ?                      show this help\r\n"
)

BANNER = (
    "\r\n"
    "  NLC Virtual PC\r\n"
    "  Type 'help' for available commands.\r\n"
    "\r\n"
)

IP_USAGE = ("  Usage: ip address <A.B.C.D>/<nn> | ip address <A.B.C.D> <mask> | ip address dhcp\r\n"
            "         ip gateway <A.B.C.D>")


def _parse_address(args: list[str]) -> tuple[str, str] | None:
    """['A.B.C.D/nn'] or ['A.B.C.D', 'M.M.M.M'] -> (address, dotted mask); None if invalid."""
    try:
        if len(args) == 1 and "/" in args[0]:
            addr, prefix = args[0].split("/", 1)
            socket.inet_pton(socket.AF_INET, addr)
            if not 0 <= int(prefix) <= 32:
                return None
            return addr, prefix_to_mask(prefix)
        if len(args) == 2:
            socket.inet_pton(socket.AF_INET, args[0])
            inverted = ~struct.unpack(">I", socket.inet_pton(socket.AF_INET, args[1]))[0] & 0xffffffff
            if inverted & (inverted + 1):           # mask bits must be contiguous
                return None
            return args[0], args[1]
    except (OSError, ValueError):
        pass
    return None


def run_cmd(pc: VirtualPC, line: str, stdin_fd: int = 0, interactive: bool = True) -> str | None:
    """interactive=False when replaying startup.cfg (no console to report to yet)."""
    parts = line.split()
    if not parts:
        return None
    cmd = parts[0].lower()
    words = [p.lower() for p in parts]

    if cmd == "ip":
        if words[1:] == ["address", "dhcp"]:
            return pc.dhcp.cmd_acquire() if interactive else pc.dhcp.enable_background()
        if words[1:2] == ["address"]:
            parsed = _parse_address(parts[2:])
            if not parsed:
                return "  Invalid address or mask.\r\n" + IP_USAGE
            addr, mask = parsed
            dhcp_was_on = pc.dhcp.disable()
            pc.ip, pc.mask = addr, mask
            return f"  IP set to {addr}/{pc._mask_to_prefix()}" + (" (DHCP disabled)" if dhcp_was_on else "")
        if words[1:2] == ["gateway"] and len(parts) == 3:
            try:
                socket.inet_pton(socket.AF_INET, parts[2])
            except OSError:
                return "  Invalid gateway address."
            pc.gateway = parts[2]
            note = " (the next DHCP lease update will replace it)" if pc.dhcp.enabled else ""
            return f"  Gateway set to {parts[2]}{note}"
        return IP_USAGE

    if words in (["renew", "dhcp"], ["release", "dhcp"]):
        if not pc.dhcp.enabled:
            return "  DHCP is not enabled (use 'ip address dhcp' first)."
        return pc.dhcp.cmd_renew() if cmd == "renew" else pc.dhcp.cmd_release()

    if words[:2] == ["debug", "dhcp"]:
        pc.dhcp.debug = True
        return "  DHCP debugging is on"
    if words[:3] == ["no", "debug", "dhcp"] or (cmd == "undebug" and words[1:2] in (["dhcp"], ["all"])):
        pc.dhcp.debug = False
        return "  DHCP debugging is off"

    if cmd == "show":
        if len(parts) == 1:
            return pc.show_status()
        if len(parts) == 2 and parts[1].lower() == "config":
            return pc.show_config()
        return "  Usage: show | show config"

    if cmd in ("save", "write", "wr"):
        return pc.save_config()

    if cmd in ("telnet", "ssh"):
        if len(parts) < 2:
            return f"  Usage: {cmd} <host> [<port>]"
        port = 23 if cmd == "telnet" else 22
        if len(parts) >= 3:
            try:
                port = int(parts[2])
                if not 1 <= port <= 65535: raise ValueError
            except ValueError:
                return "  Invalid port."
        if cmd == "telnet":
            return pc.cmd_telnet(parts[1], port, stdin_fd)
        return pc.cmd_ssh(parts[1], port)

    if cmd == "hostname":
        if len(parts) < 2:
            return "  Usage: hostname <name>"
        pc.hostname = parts[1]
        return f"  Hostname set to {parts[1]}"

    if cmd == "ping":
        if len(parts) < 2:
            return "  Usage: ping <host> [<count>]"
        count = 5
        if len(parts) >= 3:
            try:
                count = max(1, min(100, int(parts[2])))
            except ValueError:
                return "  Invalid count."
        return pc.cmd_ping(parts[1], count)

    if cmd == "get":
        if len(parts) < 2:
            return "  Usage: get http://<host>[:<port>]"
        return pc.cmd_get(parts[1])

    if cmd == "web":
        sub = parts[1].lower() if len(parts) >= 2 else ""
        if sub == "start":
            port = 80
            if len(parts) >= 3:
                try:
                    port = int(parts[2])
                except ValueError:
                    return "  Invalid port."
            return pc.cmd_web_start(port)
        if sub == "stop":
            return pc.cmd_web_stop()
        return "  Usage: web start [<port>] | web stop"

    if cmd in ("help", "?"):
        return HELP.rstrip("\r\n")

    return f"  Unknown command: {cmd}  (type 'help')"


def main() -> None:
    # Instance ID is the last positional argument passed by wrapper-linux.
    instance_id = int(sys.argv[-1]) if len(sys.argv) > 1 else 1
    pc = VirtualPC(instance_id)

    def shutdown(_signo, _frame):
        pc.stop()
        sys.stdout.write("\r\n")
        sys.stdout.flush()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    pc.start()
    run_console(
        pc,
        BANNER,
        startup=lambda: pc.load_config(lambda line: run_cmd(pc, line, interactive=False)),
        execute=lambda line, stdin_fd: run_cmd(pc, line, stdin_fd),
        help_text=HELP,
    )
    pc.stop()
