"use server";

import { getApiBaseUrl } from "../lib/backend-config";
import { serverFetch } from "../lib/auth";
import { apiErrorMessage } from "../lib/api-error";
import { PROFILES } from "../lib/topo/profiles";
import type { ContainerCatalogEntry, ContainerImage } from "../lib/topo/container-catalog";

export async function fetchImagesByProfile(): Promise<Record<string, string[]>> {
  const entries = await Promise.all(
    Object.entries(PROFILES)
      .filter(([, profile]) => !profile.fixedImage)
      .map(async ([profileId]) => {
        try {
          const res = await serverFetch(`${getApiBaseUrl()}/image/iou?profile=${profileId}`);
          if (!res.ok) return [profileId, []] as [string, string[]];
          const json = (await res.json()) as { data?: { images?: string[] } };
          return [profileId, json.data?.images ?? []] as [string, string[]];
        } catch {
          return [profileId, []] as [string, string[]];
        }
      }),
  );
  return Object.fromEntries(entries);
}

/** Local podman images for container nodes, each with the catalog entry it matches. */
export async function fetchContainerImages(): Promise<{ images: ContainerImage[]; errorMessage: string }> {
  try {
    const res = await serverFetch(`${getApiBaseUrl()}/image/container`);
    const json = (await res.json().catch(() => ({}))) as { data?: { images?: ContainerImage[] }; error?: { message?: string } };
    if (!res.ok) throw new Error(await apiErrorMessage(json, res.status));
    return { images: json.data?.images ?? [], errorMessage: "" };
  } catch (err) {
    return { images: [], errorMessage: err instanceof Error ? err.message : "Failed to list container images." };
  }
}

/** The run command / options / console shell for one catalog entry. */
export async function fetchContainerCatalogEntry(id: string): Promise<{ entry: ContainerCatalogEntry | null; errorMessage: string }> {
  try {
    const res = await serverFetch(`${getApiBaseUrl()}/image/container/catalog/${encodeURIComponent(id)}`);
    const json = (await res.json().catch(() => ({}))) as { data?: ContainerCatalogEntry; error?: { message?: string } };
    if (!res.ok || !json.data) throw new Error(await apiErrorMessage(json, res.status));
    return { entry: json.data, errorMessage: "" };
  } catch (err) {
    return { entry: null, errorMessage: err instanceof Error ? err.message : "Failed to load container catalog entry." };
  }
}

export async function listImages(): Promise<{ images: string[]; errorMessage: string }> {
  try {
    const res = await serverFetch(`${getApiBaseUrl()}/image/iou`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: { images?: string[] } };
    return { images: json.data?.images ?? [], errorMessage: "" };
  } catch (err) {
    return { images: [], errorMessage: err instanceof Error ? err.message : "Failed to list images." };
  }
}

export async function uploadImage(formData: FormData): Promise<{ ok: boolean; errorMessage: string }> {
  try {
    const res = await serverFetch(`${getApiBaseUrl()}/image/iou`, { method: "POST", body: formData });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(await apiErrorMessage(body, res.status));
    }
    return { ok: true, errorMessage: "" };
  } catch (err) {
    return { ok: false, errorMessage: err instanceof Error ? err.message : "Failed to upload image." };
  }
}

export async function deleteImage(imageName: string): Promise<{ ok: boolean; errorMessage: string }> {
  try {
    const res = await serverFetch(`${getApiBaseUrl()}/image/iou/${encodeURIComponent(imageName)}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(await apiErrorMessage(body, res.status));
    }
    return { ok: true, errorMessage: "" };
  } catch (err) {
    return { ok: false, errorMessage: err instanceof Error ? err.message : "Failed to delete image." };
  }
}

export async function getIouKey(): Promise<{ hostname: string | null; key: string | null; errorMessage: string }> {
  try {
    const res = await serverFetch(`${getApiBaseUrl()}/image/iou/key`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: { hostname?: string; key?: string | null } };
    return { hostname: json.data?.hostname ?? null, key: json.data?.key ?? null, errorMessage: "" };
  } catch (err) {
    return { hostname: null, key: null, errorMessage: err instanceof Error ? err.message : "Failed to fetch IOU/IOL key." };
  }
}

export async function setIouKey(key: string): Promise<{ ok: boolean; errorMessage: string }> {
  try {
    const res = await serverFetch(`${getApiBaseUrl()}/image/iou/key`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(await apiErrorMessage(body, res.status));
    }
    return { ok: true, errorMessage: "" };
  } catch (err) {
    return { ok: false, errorMessage: err instanceof Error ? err.message : "Failed to save IOU/IOL key." };
  }
}
