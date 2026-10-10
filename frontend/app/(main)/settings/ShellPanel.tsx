"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveWsBaseUrl } from "@/lib/ws-url";
import { createId } from "@/lib/topo/types";

const DEFAULT_FONT_SIZE = 14;
const STORAGE_KEY = "nlc-shell-session";

// Host is always the backend itself (fixed server-side); only the login user varies.
type ShellSession = { id: string; user: string };

function loadSaved(): ShellSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ShellSession) : null;
  } catch {
    return null;
  }
}

function saveSession(s: ShellSession | null) {
  try {
    if (s) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // sessionStorage unavailable — the session just won't survive navigation
  }
}

export function ShellPanel({ wsBaseUrl }: { wsBaseUrl: string }) {
  const t = useTranslations("settings.shell");
  const [user, setUser] = useState("");
  const [session, setSession] = useState<ShellSession | null>(null);

  // Restore a session from a previous visit (same tab) and re-attach to it.
  // Reading browser storage must happen after hydration (not in lazy state),
  // or the server-rendered HTML and the client's first render disagree — so the
  // set-state-in-effect this requires is the intended pattern here.
  useEffect(() => {
    const saved = loadSaved();
    if (!saved) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setUser(saved.user);
    setSession(saved);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  function connect() {
    const u = user.trim();
    if (!u) {
      toast.error(t("usernameRequired"));
      return;
    }
    const next: ShellSession = { id: createId(), user: u };
    saveSession(next);
    setSession(next);
  }

  function close() {
    saveSession(null);
    setSession(null);
  }

  return (
    // Lock the panel to the viewport (minus the global header ~4rem and the
    // section padding ~3rem) and lay it out as a column, so the terminal fills
    // the remaining space instead of pushing the page past one screen.
    <div className="mx-auto flex h-[calc(100vh-7rem)] w-full max-w-6xl flex-col">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
      <p className="mb-2 text-sm text-muted-foreground">{t("intro")}</p>
      <div className="overflow-hidden border border-border bg-card">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-x-2">
            <label className="text-sm font-medium text-muted-foreground">{t("username")}</label>
            <Input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connect()}
              placeholder={t("usernamePlaceholder")}
              className="w-48"
            />
          </div>
          <Button onClick={connect}>{session ? t("newSession") : t("connect")}</Button>
          {session && (
            <Button variant="outline" onClick={close}>
              {t("close")}
            </Button>
          )}
        </div>

      </div>

      {session && (
        <div className="mt-4 min-h-0 flex-1 overflow-hidden border border-border bg-[#18181b]">
          <ShellTerminal key={session.id} wsBaseUrl={wsBaseUrl} session={session} />
        </div>
      )}
    </div>
  );
}

function ShellTerminal({ wsBaseUrl, session }: { wsBaseUrl: string; session: ShellSession }) {
  const t = useTranslations("settings.shell");
  const containerRef = useRef<HTMLDivElement>(null);
  // Read the current translation without making the terminal effect depend on it
  // (a new `t` would otherwise tear down and reconnect the session).
  const notifyError = useEffectEvent((key: "copyFailed" | "pasteFailed") => toast.error(t(key)));

  useEffect(() => {
    const { id, user } = session;
    const term = new Terminal({ cursorBlink: true, fontSize: DEFAULT_FONT_SIZE, theme: { background: "#18181b" } });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current!);

    // SecureCRT-style clipboard shortcuts (consistent across browsers).
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type === "keydown" && e.ctrlKey && e.code === "Insert") {
        e.preventDefault();
        const text = term.getSelection();
        if (text) void navigator.clipboard.writeText(text).catch(() => notifyError("copyFailed"));
        return false;
      }
      if (e.type === "keydown" && e.shiftKey && e.code === "Insert") {
        e.preventDefault();
        void navigator.clipboard.readText().then((t) => t && term.paste(t)).catch(() => notifyError("pasteFailed"));
        return false;
      }
      return true;
    });

    function safeFit() {
      const el = containerRef.current;
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
      fitAddon.fit();
      if (term.rows > 1 && el.scrollHeight > el.clientHeight) term.resize(term.cols, term.rows - 1);
    }
    requestAnimationFrame(safeFit);
    const observer = new ResizeObserver(safeFit);
    if (containerRef.current) observer.observe(containerRef.current);

    const url = `${resolveWsBaseUrl(wsBaseUrl)}/host/shell?session=${encodeURIComponent(id)}&user=${encodeURIComponent(user)}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => term.write(`\r\n\x1b[32mConnecting as ${user}…\x1b[0m\r\n`);
    ws.onclose = (e) => {
      const reason = e.reason ? ` (${e.reason})` : "";
      term.write(`\r\n\x1b[31mDisconnected${reason}.\x1b[0m\r\n`);
    };
    ws.onerror = () => term.write("\r\n\x1b[31mWebSocket error.\x1b[0m\r\n");
    ws.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
      if (e.data instanceof ArrayBuffer) term.write(new Uint8Array(e.data));
      else term.write(e.data);
    };
    const onData = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(d);
    });

    return () => {
      onData.dispose();
      observer.disconnect();
      ws.close();
      term.dispose();
    };
  }, [wsBaseUrl, session]);

  return <div ref={containerRef} className="h-full w-full p-2" />;
}
