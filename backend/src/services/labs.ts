import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config.ts";
import type { LabSpec } from "../types/index.ts";
import { loadSpec } from "./spec.ts";

export function loadLabSpec(labId: string): LabSpec {
  return loadSpec(getLabSpecPath(labId));
}

export function getLabSpecPath(labId: string): string {
  return path.join(CONFIG.labsDir, `${labId}.json`);
}

export function hasLabSpecFile(labId: string): boolean {
  return fs.existsSync(getLabSpecPath(labId));
}

export function saveLabSpecFile(labId: string, payload: unknown): string {
  const filePath = getLabSpecPath(labId);
  fs.mkdirSync(CONFIG.labsDir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

export function deleteLabSpecFile(labId: string): string {
  const filePath = getLabSpecPath(labId);
  fs.unlinkSync(filePath);
  return filePath;
}
