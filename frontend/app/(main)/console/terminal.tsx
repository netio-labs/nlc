"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { resetNode } from "@/actions/nodes";
import { resolveWsBaseUrl } from "@/lib/ws-url";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";

const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;
const FONT_SIZE_STEP = 2;

interface ConsoleTerminalProps {
  labId: string;
  nodeId: string;
  wsBaseUrl: string;
}

export function ConsoleTerminal({ labId, nodeId, wsBaseUrl }: ConsoleTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<() => void>(() => {});
  const t = useTranslations("console.terminal");
  // Read by the connection effect without making it depend on `t`: switching the
  // language must not tear down and reset a live console session.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  function setFontSize(size: number) {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
    fitRef.current();
  }

  function handleZoomIn() {
    setFontSize((termRef.current?.options.fontSize ?? DEFAULT_FONT_SIZE) + FONT_SIZE_STEP);
  }

  function handleZoomOut() {
    setFontSize((termRef.current?.options.fontSize ?? DEFAULT_FONT_SIZE) - FONT_SIZE_STEP);
  }

  function handleResetFontSize() {
    setFontSize(DEFAULT_FONT_SIZE);
  }

  async function handleCopy() {
    const text = termRef.current?.getSelection();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.error(tRef.current("copyFailed"));
    }
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) termRef.current?.paste(text);
    } catch {
      toast.error(tRef.current("pasteFailed"));
    }
  }

  useEffect(() => {
    const term = new Terminal({ cursorBlink: true, fontSize: DEFAULT_FONT_SIZE, theme: { background: "#18181b" } });
    termRef.current = term;
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current!);

    // xterm's own SelectionService clears/changes the current selection on
    // any mousedown, including the right button — so by the time our
    // context menu's Copy handler runs, the text the user selected is
    // already gone. Stop the right-button mousedown before it reaches
    // xterm's listener (registered on a descendant of this container), one
    // capture-phase tick earlier, so the selection survives to open the menu.
    const container = containerRef.current!;
    function preserveSelectionOnRightClick(e: MouseEvent) {
      if (e.button === 2) e.stopPropagation();
    }
    container.addEventListener("mousedown", preserveSelectionOnRightClick, true);

    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Ctrl+Shift+6 (Ctrl+^) → 0x1E — Cisco escape sequence
      if (e.type === "keydown" && e.ctrlKey && e.shiftKey && e.code === "Digit6") {
        if (ws?.readyState === WebSocket.OPEN) ws.send("\x1e");
        return false;
      }
      // SecureCRT-style clipboard shortcuts — consistent across browsers,
      // unlike the native right-click menu (Firefox omits Paste there).
      // preventDefault() is required here: some browsers treat Shift+Insert
      // as a native "paste" accelerator on the focused hidden textarea, which
      // would otherwise fire xterm's own built-in paste handling too and
      // double-send the pasted text.
      if (e.type === "keydown" && e.ctrlKey && e.code === "Insert") {
        e.preventDefault();
        void handleCopy();
        return false;
      }
      if (e.type === "keydown" && e.shiftKey && e.code === "Insert") {
        e.preventDefault();
        void handlePaste();
        return false;
      }
      return true;
    });

    let ws: WebSocket | null = null;
    let observer: ResizeObserver | null = null;
    let cancelled = false;

    // FitAddon computes rows from measured cell height, but that measurement
    // can be a fraction of a pixel off from the actual rendered row height
    // (seen in Chrome, not Firefox), making the last row taller than the
    // container and clipped. scrollHeight still reports the true content
    // size even under overflow-hidden, so use it to detect and correct.
    function safeFit() {
      const el = containerRef.current;
      // Inactive console tabs are hidden with display:none, so their container
      // reports 0×0. Fitting to that would reflow the buffer down to 1 column
      // and mangle the current prompt line when the tab is shown again
      // (leading characters look deleted though they are still in the buffer).
      // Skip until the terminal is actually visible; the ResizeObserver fires
      // again with the real size when the tab is reselected.
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
      fitAddon.fit();
      if (term.rows > 1 && el.scrollHeight > el.clientHeight) {
        term.resize(term.cols, term.rows - 1);
      }
    }
    fitRef.current = safeFit;

    // Defer the initial fit until the browser has completed CSS layout.
    // Calling fit() synchronously in useEffect often sees a zero-size container.
    requestAnimationFrame(() => {
      if (!cancelled) safeFit();
    });

    async function connect() {
      term.write(`\r\n\x1b[33m${tRef.current("resetting")}\x1b[0m\r\n`);
      try {
        await resetNode(labId, nodeId);
      } catch {
        // reset failed (node not running or lab not loaded) — proceed anyway, WS will report the real error
      }
      if (cancelled) return;

      ws = new WebSocket(`${resolveWsBaseUrl(wsBaseUrl)}/labs/${labId}/nodes/${nodeId}/console`);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => term.write(`\r\n\x1b[32m${tRef.current("connected")}\x1b[0m\r\n`);
      ws.onclose = (e) => {
        const reason = e.reason ? ` (${e.reason})` : "";
        term.write(`\r\n\x1b[31m${tRef.current("disconnected", { reason })}\x1b[0m\r\n`);
      };
      ws.onerror = () => term.write(`\r\n\x1b[31m${tRef.current("wsError")}\x1b[0m\r\n`);
      ws.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
        if (e.data instanceof ArrayBuffer) term.write(new Uint8Array(e.data));
        else term.write(e.data);
      };

      term.onData((data) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(data);
      });
    }

    observer = new ResizeObserver(() => safeFit());
    observer.observe(containerRef.current!);

    void connect();

    return () => {
      cancelled = true;
      observer?.disconnect();
      container.removeEventListener("mousedown", preserveSelectionOnRightClick, true);
      ws?.close();
      term.dispose();
    };
  }, [labId, nodeId, wsBaseUrl]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={containerRef} className="h-full w-full overflow-hidden p-1" />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void handleCopy()}>
          {t("copy")}
          <ContextMenuShortcut>Ctrl+Ins</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void handlePaste()}>
          {t("paste")}
          <ContextMenuShortcut>Shift+Ins</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={handleZoomIn}>{t("zoomIn")}</ContextMenuItem>
        <ContextMenuItem onSelect={handleZoomOut}>{t("zoomOut")}</ContextMenuItem>
        <ContextMenuItem onSelect={handleResetFontSize}>{t("resetFontSize")}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
