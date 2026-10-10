"use server";

import { getApiBaseUrl } from "../lib/backend-config";
import { serverFetch } from "../lib/auth";
import { apiErrorMessage } from "../lib/api-error";
import { revalidatePath } from "next/cache";
import type { LabSpecV2 } from "../lib/topo/types";

export type LabListItem = {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
};

export async function fetchLabs(
  limit: number = 10,
  offset: number = 0,
  view: string = "update",
): Promise<{ labs: LabListItem[]; total: number; errorMessage: string }> {
  try {
    const response = await serverFetch(`${getApiBaseUrl()}/labs?limit=${limit}&offset=${offset}&view=${view}`, { method: "GET" });

    if (!response.ok) {
      throw new Error(`Failed to fetch labs: ${response.status}`);
    }

    const data = (await response.json()) as { ok: boolean; data?: { labs?: LabListItem[]; total?: number } };

    return { labs: data.data?.labs ?? [], total: data.data?.total ?? 0, errorMessage: "" };
  } catch (error) {
    return {
      labs: [],
      total: 0,
      errorMessage: error instanceof Error ? error.message : "Unknown network error.",
    };
  }
}

export async function deleteLab(labId: string): Promise<{ ok: boolean; errorMessage: string }> {
  try {
    const response = await serverFetch(`${getApiBaseUrl()}/labs/${encodeURIComponent(labId)}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(await apiErrorMessage(body, response.status));
    }

    return { ok: true, errorMessage: "" };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : "Unknown network error.",
    };
  }
}

export type LabNodeStatus = {
  id: string;
  name: string;
  instance_id: number | null;
  console_port: number | null;
  status: "running" | "stopped";
};

export async function fetchLabNodes(labId: string): Promise<LabNodeStatus[]> {
  try {
    const response = await serverFetch(`${getApiBaseUrl()}/labs/${encodeURIComponent(labId)}`);
    if (!response.ok) return [];
    const json = (await response.json()) as { data?: { nodes?: LabNodeStatus[] } };
    return json.data?.nodes ?? [];
  } catch {
    return [];
  }
}

export async function loadLab(labId: string): Promise<{ ok: boolean; errorMessage: string }> {
  try {
    const response = await serverFetch(`${getApiBaseUrl()}/labs/${encodeURIComponent(labId)}/load`, { method: "POST" });
    if (!response.ok) {
      const err = (await response.json()) as { error?: { message?: string } };
      throw new Error(await apiErrorMessage(err, response.status));
    }
    return { ok: true, errorMessage: "" };
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Load failed." };
  }
}

export async function unloadLab(labId: string): Promise<{ ok: boolean; errorMessage: string }> {
  try {
    const response = await serverFetch(`${getApiBaseUrl()}/labs/${encodeURIComponent(labId)}/unload`, { method: "POST" });
    if (!response.ok) {
      const err = (await response.json()) as { error?: { message?: string } };
      throw new Error(await apiErrorMessage(err, response.status));
    }
    return { ok: true, errorMessage: "" };
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Unload failed." };
  }
}

export async function fetchLabSpec(labId: string): Promise<LabSpecV2 | null> {
  try {
    const response = await serverFetch(`${getApiBaseUrl()}/labs/${encodeURIComponent(labId)}/spec`);
    if (!response.ok) return null;
    const json = (await response.json()) as { data?: { spec?: LabSpecV2 } };
    return json.data?.spec ?? null;
  } catch {
    return null;
  }
}

export type LabCard = { lab: LabListItem; spec: LabSpecV2 | null };

/** One page of lab cards (lab + its topology spec) for the home grid's infinite scroll. */
export async function fetchLabCards(
  offset: number,
  limit: number,
): Promise<{ cards: LabCard[]; total: number }> {
  const { labs, total } = await fetchLabs(limit, offset, "update");
  const specs = await Promise.all(labs.map((l) => fetchLabSpec(l.id)));
  return { cards: labs.map((lab, i) => ({ lab, spec: specs[i] })), total };
}

export async function saveLab(spec: LabSpecV2): Promise<{ ok: boolean; errorMessage: string }> {
  try {
    const response = await serverFetch(`${getApiBaseUrl()}/labs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spec),
    });
    if (!response.ok) {
      const err = (await response.json()) as { error?: { message?: string } };
      throw new Error(await apiErrorMessage(err, response.status));
    }
    if (response.ok) {
      revalidatePath("/labs");
      revalidatePath("/");
    }
    return { ok: true, errorMessage: "" };
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Save failed." };
  }
}

export async function updateLab(spec: LabSpecV2): Promise<{ ok: boolean; errorMessage: string }> {
  try {
    const response = await serverFetch(`${getApiBaseUrl()}/labs/${encodeURIComponent(spec.lab.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spec),
    });
    if (!response.ok) {
      const err = (await response.json()) as { error?: { message?: string } };
      throw new Error(await apiErrorMessage(err, response.status));
    }
    if (response.ok) {
      revalidatePath("/labs");
      revalidatePath("/");
    }
    return { ok: true, errorMessage: "" };
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Save failed." };
  }
}

export async function deleteLabAction(labId: string): Promise<{ ok: boolean; errorMessage: string }> {
  const result = await deleteLab(labId);
  if (result.ok) {
    revalidatePath("/labs");
    revalidatePath("/");
  }
  return result;
}

export type ActiveLabItem = LabListItem & {
  runningNodes: number;
  totalNodes: number;
};

export async function fetchActiveLabs(): Promise<{ labs: ActiveLabItem[]; errorMessage: string }> {
  try {
    const response = await serverFetch(`${getApiBaseUrl()}/labs/active`, { method: "GET" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as { ok: boolean; data?: { labs?: ActiveLabItem[] } };
    return { labs: data.data?.labs ?? [], errorMessage: "" };
  } catch (error) {
    return { labs: [], errorMessage: error instanceof Error ? error.message : "Unknown error." };
  }
}

export async function importLab(spec: unknown): Promise<{ ok: boolean; newLabId?: string; errorMessage: string }> {
  try {
    const response = await serverFetch(`${getApiBaseUrl()}/labs/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spec),
    });
    if (!response.ok) {
      const err = (await response.json()) as { error?: { message?: string } };
      throw new Error(await apiErrorMessage(err, response.status));
    }
    const json = (await response.json()) as { data?: { labId?: string } };
    revalidatePath("/labs");
    revalidatePath("/");
    return { ok: true, newLabId: json.data?.labId, errorMessage: "" };
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Import failed." };
  }
}

export async function duplicateLab(labId: string): Promise<{ ok: boolean; newLabId?: string; errorMessage: string }> {
  try {
    const response = await serverFetch(`${getApiBaseUrl()}/labs/${encodeURIComponent(labId)}/duplicate`, { method: "POST" });
    if (!response.ok) {
      const err = (await response.json()) as { error?: { message?: string } };
      throw new Error(await apiErrorMessage(err, response.status));
    }
    const json = (await response.json()) as { data?: { labId?: string } };
    revalidatePath("/labs");
    revalidatePath("/");
    return { ok: true, newLabId: json.data?.labId, errorMessage: "" };
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Duplicate failed." };
  }
}
