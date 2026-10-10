"""
Line-editing console for the Virtual PC on the node's stdin/stdout (the IOU
wrapper bridges it to the telnet console): history on Up/Down, Ctrl-C, '?'
help, and redrawing the input line when a background thread prints (see
VirtualPC.notify).
"""

import os
import select
import sys


def echo(pc, text: str) -> None:
    # Shares the lock with VirtualPC.notify so background messages can't land
    # between a keystroke's buffer update and its echo.
    with pc._out_lock:
        sys.stdout.write(text)
        sys.stdout.flush()


def run_console(pc, banner: str, startup, execute, help_text: str) -> None:
    """Print banner, run startup() (returns a status line or None), then read
    commands until stdin closes; execute(line, stdin_fd) returns their output."""
    buf = ""
    history: list[str] = []
    hist_idx = 0  # points past the end (current input position)

    pc.prompt_hook = lambda: pc.hostname + "> " + buf

    echo(pc, banner)
    pc.busy = True
    loaded = startup()
    if loaded:
        echo(pc, loaded + "\r\n")
    with pc._out_lock:
        pc.busy = False
        sys.stdout.write(pc.hostname + "> ")
        sys.stdout.flush()

    # Use the raw file descriptor to bypass Python's TextIOWrapper buffer.
    # sys.stdin.read(1) reads from an internal buffer that select() cannot see,
    # causing escape sequence bytes to leak into the main loop as printable chars.
    stdin_fd = sys.stdin.fileno()

    def read1() -> str:
        try:
            return os.read(stdin_fd, 1).decode("utf-8", errors="replace")
        except OSError:
            return ""

    def redraw(prompt: str, new_buf: str, old_buf: str) -> None:
        """Replace the current input line with new_buf."""
        extra = max(0, len(old_buf) - len(new_buf))
        echo(pc, "\r" + prompt + new_buf + " " * extra + "\b" * extra)

    while True:
        try:
            r, _, _ = select.select([stdin_fd], [], [], 60)
        except (ValueError, OSError):
            break
        if not r:
            continue

        ch = read1()
        if not ch:
            break

        if ch in ("\r", "\n"):
            cmd = buf.strip()
            with pc._out_lock:
                buf = ""
                pc.busy = True
                sys.stdout.write("\r\n")
                sys.stdout.flush()
            out = None
            if cmd:
                if not history or history[-1] != cmd:
                    history.append(cmd)
                hist_idx = len(history)
                out = execute(cmd, stdin_fd)
            else:
                hist_idx = len(history)
            with pc._out_lock:
                if out:
                    sys.stdout.write(out + "\r\n")
                sys.stdout.write(pc.hostname + "> ")
                sys.stdout.flush()
                pc.busy = False

        elif ch in ("\x7f", "\x08"):
            if buf:
                with pc._out_lock:
                    buf = buf[:-1]
                    sys.stdout.write("\b \b")
                    sys.stdout.flush()

        elif ch == "\x03":
            with pc._out_lock:
                buf = ""
                sys.stdout.write("^C\r\n" + (pc.hostname + "> "))
                sys.stdout.flush()
            hist_idx = len(history)

        elif ch == "\x1b":
            # Read CSI sequence: ESC [ X  — all three bytes arrive together.
            r2, _, _ = select.select([stdin_fd], [], [], 0.05)
            if not r2:
                continue
            ch2 = read1()
            if ch2 != "[":
                continue
            r3, _, _ = select.select([stdin_fd], [], [], 0.05)
            if not r3:
                continue
            ch3 = read1()

            prompt = pc.hostname + "> "
            if ch3 == "A" and history:  # Up arrow
                if hist_idx > 0:
                    hist_idx -= 1
                new_buf = history[hist_idx]
                redraw(prompt, new_buf, buf)
                buf = new_buf
            elif ch3 == "B":  # Down arrow
                if hist_idx < len(history):
                    hist_idx += 1
                new_buf = history[hist_idx] if hist_idx < len(history) else ""
                redraw(prompt, new_buf, buf)
                buf = new_buf

        elif ch == "?":
            echo(pc, "?\r\n" + help_text + (pc.hostname + "> ") + buf)

        elif ch >= " ":
            with pc._out_lock:
                buf += ch
                sys.stdout.write(ch)
                sys.stdout.flush()
