/*
 * Saved device configurations of a lab, each identified by its name.
 *
 *   configurations/<labId>/<name>.md   one configuration (see configMarkdown.ts)
 *   configurations/<labId>/current     name of the configuration last written by replaceConfig()
 *
 * Kept outside the lab spec so saving the topology in the editor can't clobber
 * them. Devices are matched by name; IOU nodes use their nvram, Virtual PCs
 * their startup.cfg. ioulive86 and container nodes have no config.
 */

import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { CONFIG } from "../config.ts";
import { getInstanceId } from "../db/index.ts";
import type { LabSpec } from "../types/index.ts";
import { parseConfigMarkdown, renderConfigMarkdown, type DeviceConfig } from "./configMarkdown.ts";
import { appError } from "./errors.ts";
import { isConsoleListening } from "./iou.ts";
import { loadLabSpec } from "./labs.ts";
import { consolePort } from "./node.ts";
import { buildNvram, readNvramConfig } from "./nvram.ts";
import { ensureDir, nodeRuntimeDir } from "./runtime.ts";

type SpecNode = LabSpec["nodes"][number];
type ConfigKind = "iou" | "vpc";

const VPC_CONFIG_FILE = "startup.cfg";
const CURRENT_FILE = "current";
const MAX_NAME_LENGTH = 80;
// Would collide with the /configs/replace and /configs/import routes.
const RESERVED_NAMES = new Set(["replace", "import"]);

function configKind(node: SpecNode): ConfigKind | null {
  if (node.type !== "iou") return null;
  return node.profile === "vpc" ? "vpc" : "iou";
}

function configurableNodes(spec: LabSpec): SpecNode[] {
  return spec.nodes.filter((n) => configKind(n) !== null);
}

function labConfigDir(labId: string): string {
  return path.join(CONFIG.configurationsDir, labId);
}

/** Configuration names become file names: any text except path separators and control characters. */
export function normalizeConfigName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().replace(/\.md$/i, "").trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH || name.startsWith(".") || /[/\\\x00-\x1f\x7f]/.test(name)) {
    throw appError("INVALID_CONFIG_NAME", `Configuration name must be 1-${MAX_NAME_LENGTH} characters, without / \\ or a leading dot.`);
  }
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    throw appError("INVALID_CONFIG_NAME", `"${name}" is a reserved name.`);
  }
  return name;
}

function configPath(labId: string, name: string): string {
  return path.join(labConfigDir(labId), `${normalizeConfigName(name)}.md`);
}

function duplicates(names: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const n of names) (seen.has(n) ? dup : seen).add(n);
  return [...dup];
}

function nvramPath(labId: string, nodeId: string, instanceId: number): string {
  return path.join(nodeRuntimeDir(labId, nodeId), `nvram_${String(instanceId).padStart(5, "0")}`);
}

function requireInstanceIds(spec: LabSpec, nodes: SpecNode[]): Map<string, number> {
  const ids = new Map<string, number>();
  for (const node of nodes) {
    const id = getInstanceId(spec.lab.id, node.id);
    if (!id) throw appError("LAB_NOT_LOADED", "Lab is not loaded. Load it first.");
    ids.set(node.id, id);
  }
  return ids;
}

// ── configurations ───────────────────────────────────────────────────────────

export interface ConfigInfo {
  name: string;
  modifiedAt: string;
  devices: number;
}

export function listConfigs(labId: string): { current: string | null; configs: ConfigInfo[] } {
  const dir = labConfigDir(labId);
  const configs = fs.existsSync(dir)
    ? fs.readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => {
          const file = path.join(dir, f);
          return {
            name: f.slice(0, -3),
            modifiedAt: fs.statSync(file).mtime.toISOString(),
            devices: parseConfigMarkdown(fs.readFileSync(file, "utf8")).length,
          };
        })
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    : [];
  return { current: getCurrentConfig(labId), configs };
}

export function readConfig(labId: string, name: string): string {
  const file = configPath(labId, name);
  if (!fs.existsSync(file)) throw appError("CONFIG_NOT_FOUND", `Configuration "${name}" not found.`);
  return fs.readFileSync(file, "utf8");
}

export function writeConfig(labId: string, name: string, markdown: string, overwrite: boolean): void {
  const file = configPath(labId, name);
  if (!overwrite && fs.existsSync(file)) {
    throw appError("CONFIG_EXISTS", `Configuration "${normalizeConfigName(name)}" already exists.`);
  }
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, markdown, "utf8");
}

export function deleteConfig(labId: string, name: string): void {
  const file = configPath(labId, name);
  if (!fs.existsSync(file)) throw appError("CONFIG_NOT_FOUND", `Configuration "${name}" not found.`);
  fs.unlinkSync(file);
  if (getCurrentConfig(labId) === normalizeConfigName(name)) setCurrentConfig(labId, null);
}

/** The configuration the lab's devices currently come from, i.e. the last one replaced in (informational). */
export function getCurrentConfig(labId: string): string | null {
  const file = path.join(labConfigDir(labId), CURRENT_FILE);
  if (!fs.existsSync(file)) return null;
  const name = fs.readFileSync(file, "utf8").trim();
  return name && fs.existsSync(path.join(labConfigDir(labId), `${name}.md`)) ? name : null;
}

function setCurrentConfig(labId: string, name: string | null): void {
  const file = path.join(labConfigDir(labId), CURRENT_FILE);
  if (name === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  readConfig(labId, name); // must exist
  ensureDir(labConfigDir(labId));
  fs.writeFileSync(file, normalizeConfigName(name) + "\n", "utf8");
}

export function removeLabConfigs(labId: string): void {
  fs.rmSync(labConfigDir(labId), { recursive: true, force: true });
}

export function copyLabConfigs(fromLabId: string, toLabId: string): void {
  if (fs.existsSync(labConfigDir(fromLabId))) fs.cpSync(labConfigDir(fromLabId), labConfigDir(toLabId), { recursive: true });
}

// ── match report (import / preview) ──────────────────────────────────────────

export interface MatchReport {
  matched: { name: string; type?: string; nodeType: string; typeMismatch: boolean }[];
  notInLab: string[];        // in the configuration, no such device in the lab
  notInConfig: string[];     // configurable device without a section in the configuration
  duplicates: string[];      // name used by several devices (lab or configuration): skipped
}

export function matchConfig(spec: LabSpec, devices: DeviceConfig[]): MatchReport {
  const nodes = configurableNodes(spec);
  const dup = new Set([...duplicates(nodes.map((n) => n.name)), ...duplicates(devices.map((d) => d.name))]);
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const inConfig = new Set(devices.map((d) => d.name));
  const report: MatchReport = { matched: [], notInLab: [], notInConfig: [], duplicates: [...dup] };
  for (const device of devices) {
    if (dup.has(device.name) || report.notInLab.includes(device.name)) continue;
    const node = byName.get(device.name);
    if (!node) {
      report.notInLab.push(device.name);
      continue;
    }
    report.matched.push({ name: device.name, type: device.type, nodeType: node.profile, typeMismatch: !!device.type && device.type !== node.profile });
  }
  report.notInConfig = nodes.filter((n) => !inConfig.has(n.name) && !dup.has(n.name)).map((n) => n.name);
  return report;
}

export function importConfig(labId: string, name: string, markdown: string, overwrite: boolean): MatchReport {
  const report = matchConfig(loadLabSpec(labId), parseConfigMarkdown(markdown));
  writeConfig(labId, name, markdown.replace(/^﻿/, ""), overwrite);
  return report;
}

// ── save: devices -> configuration ────────────────────────────────────────────

export interface SaveResult {
  name: string;
  devices: { name: string; type: string; status: "saved" | "empty" | "unreadable"; detail?: string }[];
  duplicates: string[];
}

async function readDeviceConfig(labId: string, node: SpecNode, instanceId: number): Promise<{ config?: string; status: SaveResult["devices"][number]["status"]; detail?: string }> {
  if (configKind(node) === "vpc") {
    const file = path.join(nodeRuntimeDir(labId, node.id), VPC_CONFIG_FILE);
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    return text.trim() ? { config: text, status: "saved" } : { status: "empty" };
  }
  const file = nvramPath(labId, node.id, instanceId);
  if (!fs.existsSync(file)) return { status: "empty" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const read = readNvramConfig(fs.readFileSync(file));
    if (read.status === "ok") return { config: read.config, status: "saved" };
    if (read.status === "empty") return { status: "empty" };
    if (read.status === "invalid") return { status: "unreadable", detail: read.reason };
    await sleep(500); // bad checksum: probably caught mid-"write memory"
  }
  return { status: "unreadable", detail: "checksum mismatch (was the device writing its config?)" };
}

export async function saveConfigFromDevices(labId: string, name: string, overwrite: boolean): Promise<SaveResult> {
  const spec = loadLabSpec(labId);
  const nodes = configurableNodes(spec);
  const ids = requireInstanceIds(spec, nodes);
  const result: SaveResult = { name: normalizeConfigName(name), devices: [], duplicates: duplicates(nodes.map((n) => n.name)) };
  const saved: DeviceConfig[] = [];
  for (const node of nodes) {
    const read = await readDeviceConfig(labId, node, ids.get(node.id)!);
    result.devices.push({ name: node.name, type: node.profile, status: read.status, detail: read.detail });
    if (read.config) saved.push({ name: node.name, type: node.profile, config: read.config });
  }
  if (saved.length === 0) {
    throw appError("NO_CONFIG_TO_SAVE", "No device has a saved configuration. Run \"write memory\" on IOU devices / \"save\" on Virtual PCs first.");
  }
  const markdown = renderConfigMarkdown({ title: result.name, lab: spec.lab.name, savedAt: new Date(), devices: saved });
  writeConfig(labId, result.name, markdown, overwrite);
  return result;
}

// ── replace: configuration -> devices──────────────────────────────────────────────

export interface ReplaceResult {
  name: string;
  devices: {
    name: string;
    type: string;
    status: "written" | "cleared" | "not-in-config" | "running" | "duplicate" | "error";
    typeMismatch?: boolean;
    detail?: string;
  }[];
}

function writeAtomic(file: string, data: Buffer | string): void {
  const tmp = `${file}.nlc-tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/**
 * Write a configuration into the lab's stopped devices (IOU nvram / VPC startup.cfg)
 * and remember it as the lab's current configuration.
 */
export function replaceConfig(labId: string, name: string): ReplaceResult {
  const configName = normalizeConfigName(name);
  const spec = loadLabSpec(labId);
  const nodes = configurableNodes(spec);
  const ids = requireInstanceIds(spec, nodes);
  const devices = parseConfigMarkdown(readConfig(labId, configName));
  const dup = new Set([...duplicates(nodes.map((n) => n.name)), ...duplicates(devices.map((d) => d.name))]);
  const configs = new Map(devices.map((d) => [d.name, d]));
  const result: ReplaceResult = { name: configName, devices: [] };

  for (const node of nodes) {
    const entry: ReplaceResult["devices"][number] = { name: node.name, type: node.profile, status: "not-in-config" };
    result.devices.push(entry);
    const device = configs.get(node.name);
    if (dup.has(node.name)) { entry.status = "duplicate"; continue; }
    if (!device) continue;
    entry.typeMismatch = !!device.type && device.type !== node.profile;
    const instanceId = ids.get(node.id)!;
    if (isConsoleListening(consolePort(instanceId))) { entry.status = "running"; continue; }

    const dir = nodeRuntimeDir(labId, node.id);
    ensureDir(dir);
    const file = configKind(node) === "vpc" ? path.join(dir, VPC_CONFIG_FILE) : nvramPath(labId, node.id, instanceId);
    try {
      if (device.config === "") {
        fs.rmSync(file, { force: true });
        entry.status = "cleared";
      } else if (configKind(node) === "vpc") {
        writeAtomic(file, device.config);
        entry.status = "written";
      } else {
        const nvramKb = typeof node.runtime.nvram === "number" ? node.runtime.nvram : CONFIG.iouRuntimeDefaults.nvram;
        writeAtomic(file, buildNvram(device.config, nvramKb));
        entry.status = "written";
      }
    } catch (err) {
      entry.status = "error";
      entry.detail = err instanceof Error ? err.message : String(err);
    }
  }
  // Only when something was actually written (not, say, every device still running).
  if (result.devices.some((d) => d.status === "written" || d.status === "cleared")) setCurrentConfig(labId, configName);
  return result;
}
