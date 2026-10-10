import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logDebug } from "./logger.ts";
import { makePcapGlobalHeader, wrapPcapPacket } from "./pcap.ts";

// ── types ────────────────────────────────────────────────────────────────────

export type SharkdFrame = {
  num: number;
  c: string[];
  bg: string;
  fg: string;
};

export type SharkdFrameDetail = {
  tree: unknown[];
  bytes: string;
  col: string[];
};

type PendingReq = { resolve: (v: unknown) => void; reject: (e: Error) => void };

type SharkdSession = {
  captureId: number;
  tempFile: string;
  proc: ReturnType<typeof spawn>;
  pending: Map<number, PendingReq>;
  nextId: number;
  sentCount: number;
  busy: boolean;
  filter: string;
  tap: (payload: Buffer) => void;
};

// ── state ────────────────────────────────────────────────────────────────────

const sessions = new Map<number, SharkdSession>();

// ── internal helpers ─────────────────────────────────────────────────────────

function sendCmd(session: SharkdSession, method: string, params?: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = session.nextId++;
    session.pending.set(id, { resolve, reject });
    session.proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }) + "\n");
  });
}

// ── public API ───────────────────────────────────────────────────────────────

export function createSharkdSession(
  captureId: number,
  dlt: number,
  addTap: (tap: (payload: Buffer) => void) => void,
): void {
  if (sessions.has(captureId)) return;

  const tempFile = path.join(os.tmpdir(), `nlc_cap_${captureId}_${Date.now()}.pcap`);
  fs.writeFileSync(tempFile, makePcapGlobalHeader(dlt));

  const tap = (payload: Buffer) => {
    fs.appendFileSync(tempFile, wrapPcapPacket(payload));
  };
  addTap(tap);

  const proc = spawn("sharkd", ["-"], { stdio: ["pipe", "pipe", "pipe"] });

  const session: SharkdSession = {
    captureId, tempFile, proc,
    pending: new Map(),
    nextId: 1,
    sentCount: 0,
    busy: false,
    filter: "",
    tap,
  };

  readline.createInterface({ input: proc.stdout! }).on("line", (line) => {
    try {
      const msg = JSON.parse(line) as { id: number; result?: unknown; error?: { message: string } };
      const p = session.pending.get(msg.id);
      if (!p) return;
      session.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    } catch { /* partial / non-json line */ }
  });

  proc.on("exit", () => {
    for (const p of session.pending.values()) p.reject(new Error("sharkd exited"));
    session.pending.clear();
    logDebug("capture", "sharkd_exit", { captureId });
  });

  sessions.set(captureId, session);
  logDebug("capture", "sharkd_created", { captureId, tempFile });
}

export function destroySharkdSession(
  captureId: number,
  removeTap: (tap: (payload: Buffer) => void) => void,
): void {
  const session = sessions.get(captureId);
  if (!session) return;

  removeTap(session.tap);
  try { session.proc.kill(); } catch { /* already dead */ }
  try { fs.unlinkSync(session.tempFile); } catch { /* already deleted */ }
  sessions.delete(captureId);
  logDebug("capture", "sharkd_destroyed", { captureId });
}

export function setSharkdFilter(captureId: number, filter: string): void {
  const session = sessions.get(captureId);
  if (!session) return;
  session.filter = filter;
  session.sentCount = 0; // reset so all frames are re-sent with new filter
}

export async function pollNewFrames(captureId: number): Promise<SharkdFrame[]> {
  const session = sessions.get(captureId);
  if (!session || session.busy) return [];

  session.busy = true;
  try {
    await sendCmd(session, "load", { file: session.tempFile });
    const status = (await sendCmd(session, "status")) as { frames: number };
    const total = status.frames;
    if (total <= session.sentCount) return [];

    const params: Record<string, unknown> = { filter: session.filter, limit: 500 };
    if (session.sentCount > 0) params.skip = session.sentCount;

    const frames = (await sendCmd(session, "frames", params)) as SharkdFrame[];
    session.sentCount = total;
    return Array.isArray(frames) ? frames : [];
  } catch (err) {
    logDebug("capture", "sharkd_poll_error", { captureId, err: String(err) });
    return [];
  } finally {
    session.busy = false;
  }
}

export async function getSharkdFrameDetail(captureId: number, frameNum: number): Promise<SharkdFrameDetail | null> {
  const session = sessions.get(captureId);
  if (!session) return null;
  try {
    return (await sendCmd(session, "frame", { frame: frameNum, proto: true, columns: true, bytes: true })) as SharkdFrameDetail;
  } catch {
    return null;
  }
}
