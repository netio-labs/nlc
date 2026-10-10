/*
 * ioulive86 node runtime: bridges one IOU node to a physical host interface.
 *
 * Unlike IOU images (see iou.ts) there is no wrapper process. The NLC build of
 * ioulive86 has its own TCP console on the node's console port, so liveness,
 * stop (SIGTERM via fuser) and reset (SIGHUP) reuse the IOU code paths.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { CONFIG } from "../config.ts";
import type { LabSpec } from "../types/index.ts";
import { appError } from "./errors.ts";
import { isConsoleListening } from "./iou.ts";
import { logDebug } from "./logger.ts";
import { labRuntimeDir, nodeRuntimeDir } from "./runtime.ts";
import { CONTAINER_TYPE, addressForPort, attachVeth, detachVeth, ensureContainerRunning, podvethName } from "./container.ts";

export const IOULIVE86_TYPE = "ioulive86";

export type HostInterface = {
  name: string;
  operstate: string;
  address: string | null;
  mtu: number | null;
};

const INTERFACE_NAME = /^[A-Za-z0-9_.:-]{1,15}$/;

export function listHostInterfaces(): HostInterface[] {
  const result = spawnSync("ip", ["-j", "link", "show"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw appError("HOST_INTERFACES_UNAVAILABLE", `ip link show failed: ${result.stderr?.trim() || result.error?.message || "unknown error"}`);
  }
  const links = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
  return links
    .filter((link) => {
      if (link.link_type !== "ether" || typeof link.ifname !== "string") return false;
      // Hide NLC-managed container veths and other virtual interfaces so the
      // physical-NIC dropdown only offers real cards.
      if ((link.ifname as string).startsWith(CONFIG.podvethPrefix)) return false;
      const kind = (link.linkinfo as Record<string, unknown> | undefined)?.info_kind;
      if (kind === "veth" || kind === "bridge") return false;
      return true;
    })
    .map((link) => ({
      name: link.ifname as string,
      operstate: typeof link.operstate === "string" ? link.operstate : "UNKNOWN",
      address: typeof link.address === "string" ? link.address : null,
      mtu: typeof link.mtu === "number" ? link.mtu : null,
    }));
}

/** Node-type rules that the generic JSON schema cannot express. Returns an error message or null. */
export function validateIoulive86Node(node: LabSpec["nodes"][number]): string | null {
  const iface = (node.runtime as Record<string, unknown>).interface;
  if (typeof iface !== "string" || !INTERFACE_NAME.test(iface)) {
    return `node ${node.name}: runtime.interface must be a host interface name`;
  }
  const ethernetPorts = node.interfaces
    .filter((item) => item.family === "ethernet")
    .reduce((sum, item) => sum + item.slotCount * item.portsPerSlot, 0);
  const serialPorts = node.interfaces
    .filter((item) => item.family === "serial")
    .reduce((sum, item) => sum + item.slotCount * item.portsPerSlot, 0);
  // e0/0 is the IOU (netio) side; "auto" adds e0/1 for the container (veth) side.
  const expected = iface === "auto" ? 2 : 1;
  if (ethernetPorts !== expected || serialPorts !== 0) {
    return `node ${node.name}: ioulive86 with interface=${iface} must expose exactly ${expected} ethernet port(s) and no serial ports`;
  }
  return null;
}

/** Each link end on an ioulive86 must use the port of its kind: netio → e0/0, veth → e0/1. */
export function validateIoulive86Links(spec: LabSpec): string | null {
  const bridges = new Map(spec.nodes.filter((n) => n.type === IOULIVE86_TYPE).map((n) => [n.id, n]));
  for (const link of spec.links ?? []) {
    const veth = link.kind === "veth";
    for (const [i, nodeId] of [link.source, link.target].entries()) {
      const bridge = bridges.get(nodeId);
      if (!bridge) continue;
      const want = veth ? 1 : 0;
      const ep = link.endpoints[i];
      if (ep.family !== "ethernet" || ep.slot !== 0 || ep.port !== want) {
        return `ioulive86 ${bridge.name}: a ${veth ? "container (veth)" : "netio"} link must use e0/${want}`;
      }
    }
  }
  return null;
}

function tailFile(pathname: string, lines: number): string {
  try {
    return fs.readFileSync(pathname, "utf8").trim().split("\n").slice(-lines).join(" | ");
  } catch {
    return "";
  }
}

/**
 * interface=auto: this ioulive86 bridges a container instead of a physical NIC.
 * Resolve the container peer from the node's veth link, ensure it is running,
 * create/inject the veth pair (named podveth<instanceId>), and return the
 * root-side veth name for ioulive86 to bind with -i.
 */
function resolveAutoInterface(
  labId: string,
  node: LabSpec["nodes"][number],
  instanceId: number,
  spec: LabSpec,
): string {
  const link = (spec.links ?? []).find(
    (l) => l.kind === "veth" && (l.source === node.id || l.target === node.id),
  );
  if (!link || link.kind !== "veth") {
    throw appError("INVALID_LAB_SPEC", `ioulive86 ${node.name}: interface=auto needs a veth link to a container`);
  }
  const containerIsSource = link.source !== node.id;
  const containerId = containerIsSource ? link.source : link.target;
  const containerPort = (containerIsSource ? link.endpoints[0] : link.endpoints[1]).port;
  const containerNode = spec.nodes.find((n) => n.id === containerId);
  if (!containerNode || containerNode.type !== CONTAINER_TYPE) {
    throw appError("INVALID_LAB_SPEC", `ioulive86 ${node.name}: veth link peer is not a container`);
  }
  
  // 确保容器正在运行，并返回容器的 PID。然后创建一个 veth 对，将容器的网络接口连接到主机的 veth 接口。
  const { pid } = ensureContainerRunning(labId, containerNode);
  const rootVeth = podvethName(instanceId);
  const contVeth = `eth${containerPort}`;
  const addr = addressForPort(containerNode, containerPort);
  detachVeth(rootVeth); // idempotent: clear any stale veth from a previous run
  attachVeth({
    pid,
    rootVeth,
    contVeth,
    address: addr?.address,
    prefix: addr?.prefix,
    gateway: addr?.gateway,
  });
  return rootVeth;
}

export async function startIoulive86Node(
  labId: string,
  node: LabSpec["nodes"][number],
  instanceId: number,
  spec: LabSpec,
): Promise<{ pid: number }> {
  if (node.type !== IOULIVE86_TYPE) {
    throw new Error(`Unsupported node type for ioulive86 runtime: ${node.type}`);
  }
  const invalid = validateIoulive86Node(node);
  if (invalid) throw appError("INVALID_LAB_SPEC", invalid);

  const requested = (node.runtime as Record<string, unknown>).interface as string;
  const iface = requested === "auto"
    ? resolveAutoInterface(labId, node, instanceId, spec)
    : requested;
  if (requested !== "auto" && !listHostInterfaces().some((item) => item.name === iface)) {
    throw appError("INTERFACE_NOT_FOUND", `Host interface ${iface} not found`);
  }
  if (!fs.existsSync(CONFIG.ioulive86Bin)) {
    throw appError("IOULIVE86_NOT_FOUND", `ioulive86 binary not found: ${CONFIG.ioulive86Bin}`);
  }

  const cwd = nodeRuntimeDir(labId, node.id);
  const netmapPath = path.join(labRuntimeDir(labId), "NETMAP");
  if (!fs.existsSync(cwd) || !fs.existsSync(netmapPath)) {
    throw appError("LAB_NOT_LOADED", "Lab runtime dir not found; load the lab first.");
  }

  const port = CONFIG.consoleBasePort + instanceId;
  const args = [
    "-n",
    CONFIG.ioulive86Bin,
    "-i", iface,
    "-n", netmapPath,
    "-p", String(port),
    "-t", node.name,
    String(instanceId),
  ];

  const logFile = path.join(cwd, "ioulive86.txt");
  const out = fs.openSync(logFile, "a");
  logDebug("ioulive86", "Starting ioulive86 node", { cmd: CONFIG.ioulive86Sudo, args });

  const child = spawn(CONFIG.ioulive86Sudo, args, { cwd, detached: true, stdio: ["ignore", out, out] });
  child.unref();
  fs.closeSync(out);

  let exitCode: number | null = null;
  child.on("exit", (code) => {
    exitCode = code ?? -1;
  });
  child.on("error", () => {
    exitCode = -1;
  });

  // ioulive86 fails fast on config problems (sudo denied, bad NETMAP, port in use).
  // Give it a moment so the caller gets a real error instead of a silent "stopped".
  for (let i = 0; i < 20; i += 1) {
    await sleep(100);
    if (isConsoleListening(port)) break;
    if (exitCode !== null) {
      throw appError(
        "IOULIVE86_START_FAILED",
        `ioulive86 exited with code ${exitCode}: ${tailFile(logFile, 3) || "no output"}`,
      );
    }
  }

  return { pid: child.pid ?? -1 };
}
