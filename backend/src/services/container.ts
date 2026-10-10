/*
 * Container node lifecycle.
 *
 * Everything runs as root through sudo:
 *   - podman run / inspect / rm / exec → `sudo -n podman` (deploy/nlc-podman.sudoers).
 *     Rootful, because images like cEOS need real root (debugfs mounts etc.).
 *   - veth plumbing → nlc-netns-helper (deploy/nlc-netns-helper.sudoers), which
 *     only ever touches podveth<N> / eth<N> interfaces.
 *
 * A container never owns a netio instance. Its IOU-facing links go through an
 * explicit ioulive86(interface=auto) node; the veth for such a link is named
 * podveth<ioulive86 instance id>, deterministic and unique among running bridges.
 */
import { spawnSync } from "node:child_process";
import { CONFIG } from "../config.ts";
import { appError } from "./errors.ts";
import { logDebug } from "./logger.ts";

// ─── rootful podman (via sudo) ────────────────────────────────────────────────

/** argv prefix that runs podman as root; shared by direct calls and the console wrapper. */
function podmanArgv(args: string[]): string[] {
  return ["-n", CONFIG.podmanBin, ...args];
}

function podman(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(CONFIG.podmanSudo, podmanArgv(args), { encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function listContainerImages(): string[] {
  const r = podman(["image", "ls", "--format", "{{.Repository}}:{{.Tag}}"]);
  if (r.status !== 0) return [];
  const seen = new Set<string>();
  for (const line of r.stdout.split("\n")) {
    const ref = line.trim();
    if (!ref || ref.includes("<none>")) continue;
    seen.add(ref);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export function containerExists(name: string): boolean {
  return podman(["container", "exists", name]).status === 0;
}

export function containerRunning(name: string): boolean {
  const r = podman(["inspect", "-f", "{{.State.Running}}", name]);
  return r.status === 0 && r.stdout.trim() === "true";
}

const HOSTNAME = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

export function runContainer(name: string, image: string, command: string[] = [], runArgs: string[] = [], hostname?: string): void {
  // --hostname <node name> (when it is a valid hostname) keeps device prompts stable
  // across re-creation; it precedes runArgs so a user-supplied --hostname wins.
  // runArgs are user-supplied `podman run` options (e.g. --privileged, -v vol:/path).
  // --network none comes after them so NLC's networking policy always wins (veths are
  // injected via the helper); command follows the image as the container's argv.
  const host = hostname && HOSTNAME.test(hostname) ? ["--hostname", hostname] : [];
  const args = ["run", "-d", "--name", name, ...host, ...runArgs, "--network", "none", image, ...command];
  logDebug("container", "podman run", { name, image, runArgs, command });
  const r = podman(args);
  if (r.status !== 0) {
    throw appError("CONTAINER_RUN_FAILED", `podman run failed: ${(r.stderr || r.stdout).trim()}`);
  }
}

export function getContainerPid(name: string): number {
  const r = podman(["inspect", "-f", "{{.State.Pid}}", name]);
  if (r.status !== 0) {
    throw appError("CONTAINER_NOT_FOUND", `podman inspect failed: ${r.stderr.trim()}`);
  }
  const pid = parseInt(r.stdout.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 1) {
    throw appError("CONTAINER_NOT_RUNNING", `container ${name} is not running`);
  }
  return pid;
}

// ─── per-node volumes ({{volume:<name>}} in runArgs) ──────────────────────────
//
// `{{volume:<name>}}` in runArgs expands to nlc-<nodeId>-<name>; no other placeholder
// exists. A named volume (unlike a bind mount) is seeded from the image path it is
// mounted on, and keeps root-owned files out of the backend's runtime dir. Lifecycle
// matches IOU nvram: kept across stop/start, removed on lab unload (nlc.lab label) or
// by Wipe Data on a stopped node (nlc.node label). Changing a node's image keeps its
// volumes; wiping them is left to the user.

const VOLUME_TOKEN = /\{\{volume:([a-zA-Z0-9][a-zA-Z0-9_.-]*)\}\}/g;

export function expandVolumes(nodeId: string, runArgs: string[]): { args: string[]; volumes: string[] } {
  const volumes = new Set<string>();
  const args = runArgs.map((a) => a.replace(VOLUME_TOKEN, (_m, name: string) => {
    const v = `nlc-${nodeId}-${name}`;
    volumes.add(v);
    return v;
  }));
  return { args, volumes: [...volumes] };
}

function ensureVolume(labId: string, nodeId: string, volume: string): void {
  if (podman(["volume", "exists", volume]).status === 0) return;
  logDebug("container", "podman volume create", { volume });
  const r = podman(["volume", "create", "--label", `nlc.lab=${labId}`, "--label", `nlc.node=${nodeId}`, volume]);
  if (r.status !== 0) {
    throw appError("CONTAINER_RUN_FAILED", `podman volume create failed: ${(r.stderr || r.stdout).trim()}`);
  }
}

/** Remove the volumes carrying all the given labels (podman ANDs label filters). */
function removeVolumesByLabel(labels: string[]): number {
  const r = podman(["volume", "ls", "-q", ...labels.flatMap((l) => ["--filter", `label=${l}`])]);
  const vols = r.status === 0 ? r.stdout.split("\n").map((v) => v.trim()).filter(Boolean) : [];
  if (vols.length === 0) return 0;
  logDebug("container", "podman volume rm", { vols });
  podman(["volume", "rm", "-f", ...vols]); // -f also drops any stray container still using one
  return vols.length;
}

/** Remove every volume created for this lab's nodes (on unload). Containers must already be gone. */
export function removeLabVolumes(labId: string): number {
  return removeVolumesByLabel([`nlc.lab=${labId}`]);
}

/** Wipe Data: remove a stopped container node's volumes, so its next start is factory-fresh. */
export function wipeContainerVolumes(labId: string, nodeId: string): number {
  if (containerRunning(containerName(labId, nodeId))) {
    throw appError("NODE_RUNNING", "Stop the node before wiping its data.");
  }
  return removeVolumesByLabel([`nlc.lab=${labId}`, `nlc.node=${nodeId}`]);
}

export function removeContainer(name: string): void {
  // rm -f cascades: kills the process tree, frees the netns, auto-destroys veths.
  if (containerExists(name)) {
    logDebug("container", "podman rm -f", { name });
    podman(["rm", "-f", name]);
  }
}

// ─── veth plumbing via the privileged helper (sudo) ───────────────────────────

export type VethConfig = {
  pid: number;
  rootVeth: string;
  contVeth: string;
  address?: string;
  prefix?: number;
  gateway?: string;
};

/** Deterministic root-side veth name for the bridge whose ioulive86 has this instance id. */
export function podvethName(instanceId: number): string {
  if (!Number.isInteger(instanceId) || instanceId < 1 || instanceId > 9999) {
    throw appError("INVALID_INSTANCE_ID", `instance id out of range: ${instanceId}`);
  }
  return `${CONFIG.podvethPrefix}${instanceId}`;
}

export function attachVeth(cfg: VethConfig): void {
  const args = [
    "-n", CONFIG.netnsHelper, "create",
    "--pid", String(cfg.pid),
    "--root-veth", cfg.rootVeth,
    "--cont-veth", cfg.contVeth,
  ];
  if (cfg.address) args.push("--addr", cfg.address);
  if (cfg.prefix != null) args.push("--prefix", String(cfg.prefix));
  if (cfg.gateway) args.push("--gateway", cfg.gateway);
  logDebug("container", "helper create", { cfg });
  const r = spawnSync("sudo", args, { encoding: "utf8" });
  if ((r.status ?? -1) !== 0) {
    throw appError("VETH_ATTACH_FAILED", `netns helper create failed: ${(r.stderr || r.stdout || "").trim()}`);
  }
}

export function detachVeth(rootVeth: string): void {
  // idempotent; the peer usually vanished with the container already
  logDebug("container", "helper delete", { rootVeth });
  spawnSync("sudo", ["-n", CONFIG.netnsHelper, "delete", "--root-veth", rootVeth], { stdio: "ignore" });
}

// ─── container node orchestration ─────────────────────────────────────────────

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LabSpec } from "../types/index.ts";
import { isConsoleListening, stopByConsolePort } from "./iou.ts";
import { nodeRuntimeDir } from "./runtime.ts";

export const CONTAINER_TYPE = "container";

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
function isIpv4(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = IPV4.exec(s);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
}

export type ContainerAddress = { port: number; address: string; prefix: number; gateway?: string };

export function containerName(_labId: string, nodeId: string): string {
  // nodeId is a globally-unique UUID, so this alone is collision-free and a valid
  // podman name ([a-zA-Z0-9][a-zA-Z0-9_.-]*).
  return `nlc-${nodeId}`;
}

function containerImage(node: LabSpec["nodes"][number]): string {
  if (typeof node.image !== "string" || node.image.length === 0) {
    throw appError("INVALID_LAB_SPEC", `container ${node.name}: image is required`);
  }
  return node.image;
}

function containerCommand(node: LabSpec["nodes"][number]): string[] {
  const cmd = (node.runtime as Record<string, unknown>).command;
  if (Array.isArray(cmd) && cmd.every((c) => typeof c === "string")) return cmd as string[];
  return []; // use the image entrypoint
}

function containerRunArgs(node: LabSpec["nodes"][number]): string[] {
  const args = (node.runtime as Record<string, unknown>).runArgs;
  if (Array.isArray(args) && args.every((a) => typeof a === "string")) return args as string[];
  return [];
}

function containerAddresses(node: LabSpec["nodes"][number]): ContainerAddress[] {
  const raw = (node.runtime as Record<string, unknown>).addresses;
  if (!Array.isArray(raw)) return [];
  return raw as ContainerAddress[];
}

/** Node-type rules the generic schema cannot express. Returns an error message or null. */
export function validateContainerNode(node: LabSpec["nodes"][number]): string | null {
  const rt = node.runtime as Record<string, unknown>;
  if (typeof node.image !== "string" || node.image.length === 0) {
    return `container ${node.name}: image is required`;
  }
  if (rt.command !== undefined && !(Array.isArray(rt.command) && rt.command.every((c) => typeof c === "string"))) {
    return `container ${node.name}: runtime.command must be an array of strings`;
  }
  if (rt.shell !== undefined && typeof rt.shell !== "string") {
    return `container ${node.name}: runtime.shell must be a string`;
  }
  if (rt.runArgs !== undefined && !(Array.isArray(rt.runArgs) && rt.runArgs.every((a) => typeof a === "string"))) {
    return `container ${node.name}: runtime.runArgs must be an array of strings`;
  }
  const badArg = ((rt.runArgs ?? []) as string[]).find((a) => a.replace(VOLUME_TOKEN, "").includes("{{"));
  if (badArg !== undefined) {
    return `container ${node.name}: runtime.runArgs "${badArg}": the only placeholder is {{volume:<name>}}`;
  }
  if (rt.addresses !== undefined) {
    if (!Array.isArray(rt.addresses)) return `container ${node.name}: runtime.addresses must be an array`;
    for (const a of rt.addresses as unknown[]) {
      const e = a as Record<string, unknown>;
      if (!Number.isInteger(e.port) || (e.port as number) < 0) return `container ${node.name}: address.port must be a non-negative integer`;
      if (!isIpv4(e.address)) return `container ${node.name}: address.address must be IPv4`;
      if (!Number.isInteger(e.prefix) || (e.prefix as number) < 0 || (e.prefix as number) > 32) return `container ${node.name}: address.prefix must be 0..32`;
      if (e.gateway !== undefined && !isIpv4(e.gateway)) return `container ${node.name}: address.gateway must be IPv4`;
    }
  }
  const eth = node.interfaces.filter((i) => i.family === "ethernet").reduce((s, i) => s + i.slotCount * i.portsPerSlot, 0);
  const serial = node.interfaces.filter((i) => i.family === "serial").reduce((s, i) => s + i.slotCount * i.portsPerSlot, 0);
  if (eth < 1 || serial > 0) return `container ${node.name}: must have at least one ethernet port and no serial ports`;
  return null;
}

/** Address config for a specific container port, if the spec provides one. */
export function addressForPort(node: LabSpec["nodes"][number], port: number): ContainerAddress | undefined {
  return containerAddresses(node).find((a) => a.port === port);
}

/** Ensure the container is running (idempotent). Safe to call from either the container node or an ioulive86(auto) peer. */
export function ensureContainerRunning(labId: string, node: LabSpec["nodes"][number]): { name: string; pid: number } {
  const name = containerName(labId, node.id);
  if (!containerRunning(name)) {
    if (containerExists(name)) removeContainer(name); // clear a stale/exited container
    const { args, volumes } = expandVolumes(node.id, containerRunArgs(node));
    for (const v of volumes) ensureVolume(labId, node.id, v);
    runContainer(name, containerImage(node), containerCommand(node), args, node.name);
  }
  return { name, pid: getContainerPid(name) };
}

function containerShell(node: LabSpec["nodes"][number]): string {
  const shell = (node.runtime as Record<string, unknown>).shell;
  return typeof shell === "string" && shell.trim() ? shell.trim() : "/bin/sh";
}

/**
 * Console loop, IOS-style: wait for RETURN, run the shell, repeat when it exits.
 * - The shell starts when someone actually uses the console, not at node start —
 *   vtysh only sees daemons running when it starts, and cEOS `Cli` needs EOS booted.
 * - `exit` in the shell returns to the prompt instead of ending the wrapper (which
 *   would close the console port and make the node look stopped).
 * `trap :` (not `trap ''`) so the shell itself still gets a default SIGINT for Ctrl-C;
 * `|| sleep 1` guards against a spin if stdin ever reads EOF.
 */
function consoleScript(shell: string): string {
  const label = shell.replace(/['"\\$`]/g, "");
  return `trap : INT; while :; do echo; echo "[nlc] Press RETURN to start ${label}"; read _ || sleep 1; ${shell}; done`;
}

function startContainerConsole(labId: string, node: LabSpec["nodes"][number], instanceId: number, name: string): void {
  const port = CONFIG.consoleBasePort + instanceId;
  if (isConsoleListening(port)) return; // console already up
  const cwd = nodeRuntimeDir(labId, node.id);
  fs.mkdirSync(cwd, { recursive: true });
  const args = ["-P", "-m", CONFIG.podmanSudo, "-p", String(port), "-t", node.name, "--",
    ...podmanArgv(["exec", "-it", name, "/bin/sh", "-c", consoleScript(containerShell(node))])];
  const out = fs.openSync(path.join(cwd, "console.txt"), "a");
  logDebug("container", "start console", { cmd: CONFIG.iouWrapper, args });
  const child = spawn(CONFIG.iouWrapper, args, { cwd, detached: true, stdio: ["ignore", out, out] });
  child.unref();
  fs.closeSync(out);
}

export function startContainerNode(labId: string, node: LabSpec["nodes"][number], instanceId: number): void {
  if (node.type !== CONTAINER_TYPE) throw new Error(`not a container node: ${node.type}`);
  const invalid = validateContainerNode(node);
  if (invalid) throw appError("INVALID_LAB_SPEC", invalid);
  const { name } = ensureContainerRunning(labId, node);
  startContainerConsole(labId, node, instanceId, name);
}

export function stopContainerNode(labId: string, node: LabSpec["nodes"][number], instanceId: number): void {
  const port = CONFIG.consoleBasePort + instanceId;
  if (isConsoleListening(port)) stopByConsolePort(port);   // stop the console wrapper
  removeContainer(containerName(labId, node.id));           // cascades: process tree + veths
}

// ─── container ↔ container direct veth links (no ioulive86 / netio) ───────────

/** True if the container currently has the given interface in its netns. */
export function containerHasInterface(name: string, iface: string): boolean {
  return podman(["exec", name, "ip", "-o", "link", "show", iface]).status === 0;
}

export type VethEnd = { pid: number; contVeth: string; address?: string; prefix?: number; gateway?: string };

/** Create a veth pair directly between two container netns via the helper. */
export function pairVeth(a: VethEnd, b: VethEnd): void {
  const args = [
    "-n", CONFIG.netnsHelper, "pair",
    "--a-pid", String(a.pid), "--a-cont-veth", a.contVeth,
    "--b-pid", String(b.pid), "--b-cont-veth", b.contVeth,
  ];
  if (a.address) args.push("--a-addr", a.address);
  if (a.prefix != null) args.push("--a-prefix", String(a.prefix));
  if (a.gateway) args.push("--a-gateway", a.gateway);
  if (b.address) args.push("--b-addr", b.address);
  if (b.prefix != null) args.push("--b-prefix", String(b.prefix));
  if (b.gateway) args.push("--b-gateway", b.gateway);
  logDebug("container", "helper pair", { a, b });
  const r = spawnSync("sudo", args, { encoding: "utf8" });
  if ((r.status ?? -1) !== 0) {
    throw appError("VETH_PAIR_FAILED", `netns helper pair failed: ${(r.stderr || r.stdout || "").trim()}`);
  }
}

/**
 * Wire up every container↔container veth link whose both endpoints are running.
 * Idempotent: skips links already wired on both sides; the helper's pair op clears
 * strays, so a restarted container (new netns, new PID) is re-wired on the next call.
 * Container↔ioulive86 links are handled by the ioulive86 auto path, not here.
 */
export function reconcileContainerLinks(labId: string, spec: LabSpec): void {
  for (const link of spec.links ?? []) {
    if (link.kind !== "veth") continue;
    const a = spec.nodes.find((n) => n.id === link.source);
    const b = spec.nodes.find((n) => n.id === link.target);
    if (!a || !b || a.type !== CONTAINER_TYPE || b.type !== CONTAINER_TYPE) continue;
    const aName = containerName(labId, a.id);
    const bName = containerName(labId, b.id);
    if (!containerRunning(aName) || !containerRunning(bName)) continue;
    const aPort = link.endpoints[0].port;
    const bPort = link.endpoints[1].port;
    const aVeth = `eth${aPort}`;
    const bVeth = `eth${bPort}`;
    if (containerHasInterface(aName, aVeth) && containerHasInterface(bName, bVeth)) continue;
    const aAddr = addressForPort(a, aPort);
    const bAddr = addressForPort(b, bPort);
    pairVeth(
      { pid: getContainerPid(aName), contVeth: aVeth, address: aAddr?.address, prefix: aAddr?.prefix, gateway: aAddr?.gateway },
      { pid: getContainerPid(bName), contVeth: bVeth, address: bAddr?.address, prefix: bAddr?.prefix, gateway: bAddr?.gateway },
    );
  }
}
