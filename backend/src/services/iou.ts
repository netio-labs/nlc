import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config.ts";
import type { LabSpec } from "../types/index.ts";
import { appError } from "./errors.ts";
import { ensureDir, labRuntimeDir, nodeRuntimeDir } from "./runtime.ts";
import { logDebug } from "./logger.ts";

function cleanupNetioLock(instanceId: number): void {
  const netioDir = CONFIG.netioDir;
  const sockPath = path.join(netioDir, String(instanceId));
  const lockPath = `${sockPath}.lck`;
  try {
    if (fs.existsSync(sockPath)) fs.unlinkSync(sockPath);
  } catch {
    // Best-effort cleanup.
  }
  try {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch {
    // Best-effort cleanup.
  }
}

function requireFile(pathname: string, errorCode: string, message: string): void {
  if (!fs.existsSync(pathname)) {
    throw appError(errorCode, message);
  }
}

function getSlotCountByFamily(node: LabSpec["nodes"][number], family: "ethernet" | "serial"): number {
  return node.interfaces
    .filter((item) => item.family === family)
    .reduce((sum, item) => sum + item.slotCount, 0);
}

function parseRuntimeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function writeNetmap(labId: string, lines: string[]): string {
  const dir = labRuntimeDir(labId);
  ensureDir(dir);
  const netmapPath = path.join(dir, "NETMAP");
  fs.writeFileSync(netmapPath, lines.join("\n") + "\n", "utf8");
  return netmapPath;
}

export function buildNetmapLines(spec: LabSpec, instanceMap: Map<string, number>): string[] {
  const links = spec.links ?? [];
  const lines: string[] = [];
  for (const link of links) {
    // veth links (container connections) are pure kernel veth pairs — no netio/NETMAP.
    if (link.kind === "veth") continue;
    const [sourceEndpoint, targetEndpoint] = link.endpoints;
    if (!sourceEndpoint || !targetEndpoint) continue;
    const sourceId = instanceMap.get(link.source);
    const targetId = instanceMap.get(link.target);
    if (sourceId == null || targetId == null) {
      throw appError("LAB_NOT_LOADED", "Instance id not allocated for node");
    }
    lines.push(`${sourceId}:${sourceEndpoint.slot}/${sourceEndpoint.port} ${targetId}:${targetEndpoint.slot}/${targetEndpoint.port}`);
  }
  logDebug("iou", "Generated IOU netmap lines", { lines });
  return lines;
}

export function ensureIourc(labId: string, nodeId: string, iourcPath: string): void {
  const dir = nodeRuntimeDir(labId, nodeId);
  requireFile(dir, "LAB_NOT_LOADED", "Lab runtime dir not found; load the lab first.");
  const target = path.join(dir, "iourc");
  // iourc is optional: newer IOL images start without a key, and images that
  // need one report it on their own console.
  if (!fs.existsSync(iourcPath)) {
    logDebug("iou", "No iourc; starting without a key", { iourcPath });
    return;
  }
  if (!fs.existsSync(target)) {
    fs.symlinkSync(iourcPath, target);
  }
}

export function ensureNetmapLink(labId: string, nodeId: string): void {
  const dir = nodeRuntimeDir(labId, nodeId);
  requireFile(dir, "LAB_NOT_LOADED", "Lab runtime dir not found; load the lab first.");
  const target = path.join(dir, "NETMAP");
  if (!fs.existsSync(target)) {
    fs.symlinkSync("../NETMAP", target);
  }
}

export function startIouNode(labId: string, node: LabSpec["nodes"][number], instanceId: number): { pid: number } {
  if (node.type !== "iou") {
    throw new Error(`Unsupported node type for IOU runtime: ${node.type}`);
  }

  const port = CONFIG.consoleBasePort + instanceId;
  const cwd = nodeRuntimeDir(labId, node.id);

  cleanupNetioLock(instanceId);
  ensureIourc(labId, node.id, CONFIG.iourc);
  ensureNetmapLink(labId, node.id);

  const imagePath = path.isAbsolute(node.image) ? node.image : path.join(CONFIG.iouDir, node.image);

  if (!fs.existsSync(imagePath)) {
    throw new Error(`IOU image not found: ${imagePath}`);
  }

  const imageLocal = path.join(cwd, path.basename(imagePath));
  if (!fs.existsSync(imageLocal)) {
    fs.symlinkSync(imagePath, imageLocal);
  }

  const runtime = node.runtime as Record<string, unknown>;
  const ram = parseRuntimeNumber(runtime.ram, CONFIG.iouRuntimeDefaults.ram);
  const nvram = parseRuntimeNumber(runtime.nvram, CONFIG.iouRuntimeDefaults.nvram);
  const ethernet = getSlotCountByFamily(node, "ethernet");
  const serial = getSlotCountByFamily(node, "serial");
  const { delay, l2keepalive, watchdog, ignoreNetmap } = CONFIG.iouProcessDefaults;

  const args: string[] = ["-m", imageLocal, "-p", String(port), "-d", String(delay), "-t", node.name, "--"];

  args.push("-e", String(ethernet));
  args.push("-s", String(serial));
  args.push("-n", String(nvram));
  args.push("-m", String(ram));

  if (l2keepalive) args.push("-l");
  if (!watchdog) args.push("-W");
  if (ignoreNetmap) args.push("-N");

  // Startup config not wired yet; placeholder for future "-c <config>"
  // args.push('-c', `config-${padId(node.id)}`);

  args.push(String(instanceId));

  const logFile = path.join(cwd, "wrapper.txt");
  const out = fs.openSync(logFile, "a");

  logDebug("iou", "Starting IOU node with wrapper", { cmd: CONFIG.iouWrapper, args });

  const child = spawn(CONFIG.iouWrapper, args, { cwd, detached: true, stdio: ["ignore", out, out] });
  child.unref();

  return { pid: child.pid ?? -1 };
}

export function isConsoleListening(port: number): boolean {
  try {
    const { status } = spawnSync("fuser", ["-n", "tcp", String(port)], { stdio: "ignore" });
    logDebug("iou", "Checked console listening status", { cmd: `fuser -n tcp ${port}`, status });
    return status === 0;
  } catch {
    return false;
  }
}

export function stopByConsolePort(port: number): void {
  try {
    spawnSync("fuser", ["-n", "tcp", "-k", "-TERM", String(port)], { stdio: "ignore" });
    logDebug("iou", "Sent SIGTERM to console listener", { cmd: `fuser -n tcp -k -TERM ${port}` });
  } catch {
    return;
  }
}

export function resetConsoleByPort(port: number): boolean {
  // Only the console owner (wrapper-linux parent or ioulive86) holds the port;
  // SIGHUP makes it drop the current telnet client while the device keeps running.
  try {
    const { status } = spawnSync("fuser", ["-n", "tcp", "-k", "-HUP", String(port)], { stdio: "ignore" });
    logDebug("iou", "Sent SIGHUP to console listener for reset", { cmd: `fuser -n tcp -k -HUP ${port}`, status });
    return status === 0;
  } catch {
    return false;
  }
}
