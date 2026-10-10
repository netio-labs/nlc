"use server";

import { getApiBaseUrl } from "../lib/backend-config";
import { serverFetch } from "../lib/auth";
import { apiErrorMessage } from "../lib/api-error";

export type CaptureInfo = {
  captureId: number;
  linkId: string;
  captureUrl: string;
  dlt: number;
};

export async function startLabCapture(
  labId: string,
  linkId: string,
  encap?: string,
): Promise<{ ok: boolean; errorMessage: string; data?: CaptureInfo }> {
  try {
    const response = await serverFetch(`${getApiBaseUrl()}/labs/${encodeURIComponent(labId)}/captures`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkId, encap }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(await apiErrorMessage(body, response.status));
    }
    const { data } = (await response.json()) as { data: CaptureInfo };
    return { ok: true, errorMessage: "", data };
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Failed to start capture" };
  }
}

export async function stopLabCapture(
  labId: string,
  captureId: number,
): Promise<{ ok: boolean; errorMessage: string }> {
  try {
    const response = await serverFetch(
      `${getApiBaseUrl()}/labs/${encodeURIComponent(labId)}/captures/${captureId}/stop`,
      { method: "POST" },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(await apiErrorMessage(body, response.status));
    }
    return { ok: true, errorMessage: "" };
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Failed to stop capture" };
  }
}

export async function listLabCaptures(labId: string, linkId?: string): Promise<CaptureInfo[]> {
  try {
    const url = new URL(`${getApiBaseUrl()}/labs/${encodeURIComponent(labId)}/captures`);
    if (linkId) url.searchParams.set("linkId", linkId);
    const response = await serverFetch(url.toString());
    if (!response.ok) return [];
    const { data } = (await response.json()) as { data: CaptureInfo[] };
    return data ?? [];
  } catch {
    return [];
  }
}
