import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config.ts";

function runtimeRootDir(): string {
  return path.resolve(CONFIG.rootDir, CONFIG.runtimeDir);
}

export function labRuntimeDir(labId: string): string {
  return path.join(runtimeRootDir(), `lab_${labId}`);
}

export function nodeRuntimeDir(labId: string, nodeId: string): string {
  return path.join(
    runtimeRootDir(),
    `lab_${labId}`,
    `dev_${nodeId}`,
  );
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function prepareLabRuntimeDir(labId: string): void {
  ensureDir(labRuntimeDir(labId));
}

export function prepareNodeRuntimeDirs(
  labId: string,
  nodeIds: string[],
): void {
  ensureDir(labRuntimeDir(labId));
  for (const nodeId of nodeIds) {
    ensureDir(nodeRuntimeDir(labId, nodeId));
  }
}

export function removeLabRuntimeDir(labId: string): { removed: boolean; path: string } {
  const dir = labRuntimeDir(labId);
  if (!fs.existsSync(dir)) {
    return { removed: false, path: dir };
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { removed: true, path: dir };
}
