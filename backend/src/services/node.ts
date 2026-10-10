import { CONFIG } from "../config.ts";
import type { LabSpec } from "../types/index.ts";
import { requireInstanceId } from "../db/index.ts";
import { isConsoleListening, resetConsoleByPort, startIouNode, stopByConsolePort } from "./iou.ts";
import { IOULIVE86_TYPE, startIoulive86Node } from "./ioulive86.ts";
import { CONTAINER_TYPE, detachVeth, podvethName, startContainerNode, stopContainerNode } from "./container.ts";

// Console ports are consoleBasePort + instanceId for every node type. Instance ids
// are globally unique (shared pool), so container consoles never collide with IOU.
export function consolePort(instanceId: number): number {
  return CONFIG.consoleBasePort + instanceId;
}

export async function startNode(labId: string, node: LabSpec["nodes"][number], spec: LabSpec): Promise<void> {
  const instanceId = requireInstanceId(labId, node.id);
  if (node.type === "iou") {
    startIouNode(labId, node, instanceId);
    return;
  }
  if (node.type === IOULIVE86_TYPE) {
    await startIoulive86Node(labId, node, instanceId, spec);
    return;
  }
  if (node.type === CONTAINER_TYPE) {
    startContainerNode(labId, node, instanceId);
    return;
  }
  throw new Error(`Unsupported node type: ${node.type}`);
}

export function stopNode(labId: string, node: LabSpec["nodes"][number]): void {
  const instanceId = requireInstanceId(labId, node.id);
  if (node.type === CONTAINER_TYPE) {
    stopContainerNode(labId, node, instanceId);
    return;
  }
  const port = consolePort(instanceId);
  if (isConsoleListening(port)) {
    stopByConsolePort(port);
  }
  // ioulive86(auto) bridges a container over podveth<instanceId>; drop it on stop
  // (best-effort — it usually vanished already when the container was removed).
  if (node.type === IOULIVE86_TYPE && (node.runtime as Record<string, unknown>).interface === "auto") {
    detachVeth(podvethName(instanceId));
  }
}

export function resetConsole(labId: string, nodeId: string): boolean {
  const instanceId = requireInstanceId(labId, nodeId);
  const port = consolePort(instanceId);
  if (!isConsoleListening(port)) return false;
  return resetConsoleByPort(port);
}
