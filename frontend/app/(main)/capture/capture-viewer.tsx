"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { resolveWsBaseUrl } from "@/lib/ws-url";

// ── Types from sharkd ─────────────────────────────────────────────────────────

type Frame = {
  num: number;
  c: string[]; // [No, Time, Src, Dst, Protocol, Len, Info]
  bg: string;
  fg: string;
};

type TreeNode = {
  l: string; // label
  h?: [number, number]; // [offset, length]
  t?: string; // "proto"
  f?: string; // filter expression
  fn?: string; // field name
  g?: boolean; // generated
  n?: TreeNode[]; // children
};

type FrameDetail = {
  tree: TreeNode[];
  bytes: string; // base64
  col: string[];
};

type ServerMsg =
  | { type: "frame"; data: Frame }
  | { type: "frame_detail"; frameNum: number; tree: TreeNode[]; bytes: string; col: string[] }
  | { type: "clear" }
  | { type: "error"; message: string };

// ── Column headers ────────────────────────────────────────────────────────────

// Message keys under capture.cols.
const COLS = ["no", "time", "source", "destination", "protocol", "length", "info"] as const;
const COL_WIDTHS = ["w-12", "w-28", "w-36", "w-36", "w-24", "w-16", "flex-1"];

// ── Proto tree node ───────────────────────────────────────────────────────────

function ProtoNode({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.n && node.n.length > 0;
  const isProto = node.t === "proto";

  return (
    <div style={{ paddingLeft: depth * 14 }}>
      <div
        className={`flex items-start gap-1 py-0.5 text-[11px] leading-4 ${hasChildren ? "cursor-pointer hover:bg-zinc-800" : ""}`}
        onClick={() => hasChildren && setOpen((v) => !v)}
      >
        <span className="w-3 shrink-0 text-zinc-500">{hasChildren ? (open ? "▾" : "▸") : ""}</span>
        <span className={isProto ? "font-semibold text-zinc-200" : "text-zinc-300"}>{node.l}</span>
      </div>
      {open && hasChildren && node.n!.map((child, i) => <ProtoNode key={i} node={child} depth={depth + 1} />)}
    </div>
  );
}

// ── Hex dump ──────────────────────────────────────────────────────────────────

function HexDump({ b64 }: { b64: string }) {
  const bytes = Array.from(atob(b64), (c) => c.charCodeAt(0));
  const rows: number[][] = [];
  for (let i = 0; i < bytes.length; i += 16) rows.push(bytes.slice(i, i + 16));

  return (
    <div className="font-mono text-[10px] leading-4 text-zinc-300">
      {rows.map((row, ri) => (
        <div key={ri} className="flex gap-3">
          <span className="w-10 shrink-0 text-zinc-600">{(ri * 16).toString(16).padStart(4, "0")}</span>
          <span className="w-48">
            {row.map((b, i) => (
              <span key={i}>
                {b.toString(16).padStart(2, "0")}
                {i === 7 ? "  " : " "}
              </span>
            ))}
          </span>
          <span className="text-zinc-400">
            {row.map((b, i) => (
              <span key={i}>{b >= 32 && b < 127 ? String.fromCharCode(b) : "."}</span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main viewer ───────────────────────────────────────────────────────────────

interface CaptureViewerProps {
  labId: string;
  captureId: number;
  labName: string;
  wsBaseUrl: string;
}

type ConnState = "connecting" | "connected" | "disconnected";

const DETAIL_MIN_H = 80;
const DETAIL_MAX_H = 600;
const DETAIL_DEFAULT_H = 224;

export function CaptureViewer({ labId, captureId, labName, wsBaseUrl }: CaptureViewerProps) {
  const t = useTranslations("capture");
  const [frames, setFrames] = useState<Frame[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<FrameDetail | null>(null);
  const [connState, setConnState] = useState<ConnState>("connecting");
  const [filterInput, setFilterInput] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [detailHeight, setDetailHeight] = useState(DETAIL_DEFAULT_H);

  const wsRef = useRef<WebSocket | null>(null);
  const tableBodyRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: detailHeight };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      setDetailHeight(Math.max(DETAIL_MIN_H, Math.min(DETAIL_MAX_H, dragRef.current.startH + delta)));
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [detailHeight]);

  useEffect(() => {
    const ws = new WebSocket(`${resolveWsBaseUrl(wsBaseUrl)}/labs/${labId}/captures/${captureId}/stream`);
    wsRef.current = ws;

    ws.onopen = () => setConnState("connected");
    ws.onclose = () => setConnState("disconnected");

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as ServerMsg;
      if (msg.type === "frame") {
        setFrames((prev) => [...prev, msg.data]);
      } else if (msg.type === "frame_detail") {
        setDetail({ tree: msg.tree, bytes: msg.bytes, col: msg.col });
      } else if (msg.type === "clear") {
        setFrames([]);
        setSelected(null);
        setDetail(null);
      }
    };

    return () => ws.close();
  }, [labId, captureId, wsBaseUrl]);

  // Auto-scroll packet list
  useEffect(() => {
    if (autoScroll && tableBodyRef.current) {
      tableBodyRef.current.scrollTop = tableBodyRef.current.scrollHeight;
    }
  }, [frames, autoScroll]);

  const handleRowClick = useCallback((frameNum: number) => {
    setSelected(frameNum);
    setDetail(null);
    wsRef.current?.send(JSON.stringify({ type: "frame_detail", frameNum }));
  }, []);

  const applyFilter = () => {
    setActiveFilter(filterInput);
    wsRef.current?.send(JSON.stringify({ type: "filter", expr: filterInput }));
  };

  const clearFilter = () => {
    setFilterInput("");
    setActiveFilter("");
    wsRef.current?.send(JSON.stringify({ type: "filter", expr: "" }));
  };

  const statusColor = connState === "connected" ? "text-green-400" : connState === "connecting" ? "text-yellow-400" : "text-red-400";

  return (
    <div className="flex h-full flex-col text-zinc-100">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-zinc-700 bg-zinc-900 px-4 py-2">
        <span className="font-semibold text-zinc-200">{labName}</span>
        <span className="font-mono text-xs text-zinc-400">{t("title", { id: String(captureId) })}</span>
        <span className={`ml-auto text-xs font-mono ${statusColor}`}>● {t(`state.${connState}`)}</span>
        <span className="text-xs text-zinc-400">{t("packets", { count: String(frames.length) })}</span>
      </div>

      {/* Filter bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-700 bg-zinc-900 px-4 py-1.5">
        <input
          className="h-7 flex-1 rounded border border-zinc-600 bg-zinc-800 px-2 font-mono text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder={t("filterPlaceholder")}
          value={filterInput}
          onChange={(e) => setFilterInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && applyFilter()}
        />
        <button
          className="h-7 rounded bg-blue-600 px-3 text-xs hover:bg-blue-500 disabled:opacity-50"
          onClick={applyFilter}
          disabled={connState !== "connected"}
        >
          {t("apply")}
        </button>
        {activeFilter && (
          <button className="h-7 rounded bg-zinc-700 px-3 text-xs hover:bg-zinc-600" onClick={clearFilter}>
            {t("clear")}
          </button>
        )}
        <label className="ml-2 flex items-center gap-1.5 text-xs text-zinc-400">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          {t("autoScroll")}
        </label>
      </div>

      {/* Packet list */}
      <div
        ref={tableBodyRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          if (!atBottom && autoScroll) setAutoScroll(false);
        }}
      >
        {/* Column headers */}
        <div className="sticky top-0 z-10 flex border-b border-zinc-700 bg-zinc-800 text-[11px] font-semibold text-zinc-400">
          {COLS.map((col, i) => (
            <div key={col} className={`shrink-0 px-2 py-1 ${COL_WIDTHS[i]}`}>
              {t(`cols.${col}`)}
            </div>
          ))}
        </div>

        {/* Rows */}
        {frames.map((f) => (
          <div
            key={f.num}
            className={`flex cursor-pointer border-b border-zinc-800/50 text-[11px] hover:brightness-110 ${selected === f.num ? "ring-1 ring-blue-400 ring-inset" : ""}`}
            style={{ backgroundColor: `#${f.bg}`, color: `#${f.fg}` }}
            onClick={() => handleRowClick(f.num)}
          >
            {f.c.map((val, i) => (
              <div key={i} className={`shrink-0 truncate px-2 py-0.5 ${COL_WIDTHS[i]}`} title={val}>
                {val}
              </div>
            ))}
          </div>
        ))}

        {frames.length === 0 && (
          <p className="p-6 text-center text-xs text-zinc-500">
            {connState === "connected" ? t("waiting") : connState === "connecting" ? t("connecting") : t("disconnected")}
          </p>
        )}
      </div>

      {/* Detail panel */}
      {selected !== null && (
        <div className="flex shrink-0 flex-col border-t border-zinc-700" style={{ height: detailHeight }}>
          {/* Drag handle */}
          <div
            className="group flex h-2.5 shrink-0 cursor-row-resize items-center justify-center bg-zinc-800 hover:bg-zinc-700"
            onMouseDown={onDragStart}
          >
            <div className="h-0.5 w-8 rounded-full bg-zinc-600 group-hover:bg-zinc-400 transition-colors" />
          </div>
          {/* Content */}
          <div className="flex min-h-0 flex-1 bg-zinc-900">
            <div className="w-2/3 overflow-y-auto border-r border-zinc-700 p-2">
              {detail ? (
                detail.tree.map((node, i) => <ProtoNode key={i} node={node as TreeNode} depth={0} />)
              ) : (
                <p className="text-xs text-zinc-500">{t("loading")}</p>
              )}
            </div>
            <div className="w-1/3 overflow-y-auto p-2">
              {detail?.bytes ? <HexDump b64={detail.bytes} /> : <p className="text-xs text-zinc-500">{t("loading")}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
