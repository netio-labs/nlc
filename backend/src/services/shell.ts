/*
 * Host SSH gateway for the web terminal.
 *
 * NLC grants no privilege here: it spawns the system `ssh` client on a pty
 * (via wrapper-linux, the same pty bridge consoles use) and proxies the raw
 * byte stream to the browser. Authentication is entirely between the user and
 * the host's sshd — the ssh client prompts for the password on the pty and the
 * user types it in the browser terminal; NLC never parses or stores credentials.
 *
 * Sessions are persistent: the ssh process (via its wrapper) keeps running when
 * the browser disconnects, so navigating away and back re-attaches to the same
 * live session — wrapper-linux replays its scrollback to the reconnecting
 * client. Each session is keyed by an unguessable id held by the client. A
 * detached session is reaped after SHELL_IDLE_MS with no client.
 */
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { CONFIG } from "../config.ts";
import { appError } from "./errors.ts";
import { logDebug } from "./logger.ts";

// Leading alphanumeric forbids values starting with '-' (would be read as an
// ssh option); the rest are the usual username/hostname characters.
const USER_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/;
const HOST_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,254}$/;
const SESSION_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

const SHELL_IDLE_MS = 30 * 60 * 1000; // reap a client-less session after 30 min
const MAX_SESSIONS = 20;

/** Returns an error message, or null if the target is safe to pass to ssh. */
export function validateShellTarget(user: string, host: string): string | null {
  if (!USER_RE.test(user)) return "invalid username";
  if (!HOST_RE.test(host)) return "invalid host";
  return null;
}

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id);
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

async function waitListening(port: number, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise<boolean>((res) => {
      const s = net.connect({ host: "127.0.0.1", port }, () => {
        s.destroy();
        res(true);
      });
      s.on("error", () => res(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw appError("SHELL_START_FAILED", "ssh wrapper did not start listening");
}

/** Spawn `ssh -l user host` on a pty (wrapper-linux) listening on a fresh localhost port. */
async function spawnSshWrapper(user: string, host: string): Promise<{ port: number; proc: ChildProcess }> {
  const port = await findFreePort();
  const args = [
    "-P", "-m", "/usr/bin/ssh", "-p", String(port), "-t", `ssh ${user}@${host}`,
    "--",
    "-tt", // force remote pty even though stdin is already a pty
    "-o", "StrictHostKeyChecking=accept-new", // don't hang on first-connect host-key prompt
    "-l", user, host,
  ];
  logDebug("shell", "spawn ssh wrapper", { user, host, port });
  const proc = spawn(CONFIG.iouWrapper, args, { stdio: "ignore" });
  proc.on("error", (err) => logDebug("shell", "wrapper spawn error", { err: String(err) }));

  await waitListening(port);
  return { port, proc };
}

// ─── persistent session registry ──────────────────────────────────────────────

type ShellSession = {
  id: string;
  port: number;
  proc: ChildProcess;
  user: string;
  host: string;
  attached: boolean;
  idleTimer?: NodeJS.Timeout;
};

const sessions = new Map<string, ShellSession>();

function isAlive(proc: ChildProcess): boolean {
  return proc.exitCode === null && proc.signalCode === null;
}

/** Kill a session's ssh process and drop it from the registry. */
export function killShellSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  if (s.idleTimer) clearTimeout(s.idleTimer);
  sessions.delete(id);
  logDebug("shell", "kill session", { id, user: s.user, host: s.host });
  s.proc.kill("SIGTERM");
}

/**
 * Attach to the session `id`, creating it if needed. Reuses a live session with
 * a matching target (replaying its scrollback via the wrapper); a mismatched or
 * dead session under the same id is replaced. Throws SHELL_BUSY if a client is
 * already attached.
 */
export async function acquireShellSession(id: string, user: string, host: string): Promise<ShellSession> {
  const invalid = validateShellTarget(user, host);
  if (invalid) throw appError("INVALID_SHELL_TARGET", invalid);
  if (!isValidSessionId(id)) throw appError("INVALID_SHELL_TARGET", "invalid session id");

  const existing = sessions.get(id);
  if (existing) {
    if (isAlive(existing.proc) && existing.user === user && existing.host === host) {
      if (existing.attached) throw appError("SHELL_BUSY", "session already has a client");
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = undefined;
      }
      existing.attached = true;
      logDebug("shell", "reattach session", { id, user, host, port: existing.port });
      return existing;
    }
    // stale (dead proc) or the id was reused for a different target — replace it
    killShellSession(id);
  }

  // Reap the oldest detached session if we're at capacity.
  if (sessions.size >= MAX_SESSIONS) {
    const victim = [...sessions.values()].find((s) => !s.attached);
    if (!victim) throw appError("SHELL_START_FAILED", "too many active shell sessions");
    killShellSession(victim.id);
  }

  const { port, proc } = await spawnSshWrapper(user, host);
  const session: ShellSession = { id, port, proc, user, host, attached: true };
  sessions.set(id, session);
  // If ssh exits on its own (user typed `exit`, auth failed, etc.), drop it.
  proc.on("exit", () => {
    const cur = sessions.get(id);
    if (cur === session) {
      if (cur.idleTimer) clearTimeout(cur.idleTimer);
      sessions.delete(id);
      logDebug("shell", "session process exited", { id });
    }
  });
  return session;
}

/** Detach the client from a session, keeping ssh alive; reap it after an idle timeout. */
export function releaseShellSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  s.attached = false;
  if (s.idleTimer) clearTimeout(s.idleTimer);
  s.idleTimer = setTimeout(() => killShellSession(id), SHELL_IDLE_MS);
  logDebug("shell", "detach session", { id });
}
