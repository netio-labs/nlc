"use server";

import { revalidatePath } from "next/cache";
import { getApiBaseUrl } from "../lib/backend-config";
import { serverFetch } from "../lib/auth";
import { apiErrorMessage } from "../lib/api-error";

type NodeActionResult = { ok: boolean; errorMessage: string };

async function nodePost(url: string): Promise<NodeActionResult> {
  try {
    const response = await serverFetch(url, { method: "POST" });
    if (!response.ok) {
      const err = (await response.json()) as { error?: { message?: string } };
      throw new Error(await apiErrorMessage(err, response.status));
    }
    return { ok: true, errorMessage: "" };
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Request failed." };
  }
}

export async function startNode(labId: string, nodeId: string): Promise<NodeActionResult> {
  return nodePost(`${getApiBaseUrl()}/labs/${encodeURIComponent(labId)}/nodes/${encodeURIComponent(nodeId)}/start`);
}

export async function stopNode(labId: string, nodeId: string): Promise<NodeActionResult> {
  return nodePost(`${getApiBaseUrl()}/labs/${encodeURIComponent(labId)}/nodes/${encodeURIComponent(nodeId)}/stop`);
}

export async function resetNode(labId: string, nodeId: string): Promise<NodeActionResult> {
  return nodePost(`${getApiBaseUrl()}/labs/${encodeURIComponent(labId)}/nodes/${encodeURIComponent(nodeId)}/reset`);
}

/** Wipe Data: delete a stopped container node's volumes. */
export async function wipeNode(labId: string, nodeId: string): Promise<NodeActionResult> {
  return nodePost(`${getApiBaseUrl()}/labs/${encodeURIComponent(labId)}/nodes/${encodeURIComponent(nodeId)}/wipe`);
}

export async function startAllNodes(labId: string): Promise<NodeActionResult> {
  return nodePost(`${getApiBaseUrl()}/labs/${encodeURIComponent(labId)}/nodes/start`);
}

export async function stopAllNodes(labId: string): Promise<NodeActionResult> {
  return nodePost(`${getApiBaseUrl()}/labs/${encodeURIComponent(labId)}/nodes/stop`);
}

export async function stopAllNodesAction(labId: string): Promise<NodeActionResult> {
  const result = await stopAllNodes(labId);
  if (result.ok) {
    revalidatePath("/labs");
    revalidatePath("/");
  }
  return result;
}
