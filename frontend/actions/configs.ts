"use server";

import { getApiBaseUrl } from "../lib/backend-config";
import { serverFetch } from "../lib/auth";
import { apiErrorMessage } from "../lib/api-error";

// ─── Types (mirror backend/src/services/configs.ts) ─────────────────────────

export type ConfigInfo = { name: string; modifiedAt: string; devices: number };

export type MatchReport = {
  matched: { name: string; type?: string; nodeType: string; typeMismatch: boolean }[];
  notInLab: string[];
  notInConfig: string[];
  duplicates: string[];
};

export type SaveResult = {
  name: string;
  devices: { name: string; type: string; status: "saved" | "empty" | "unreadable"; detail?: string }[];
  duplicates: string[];
};

export type ReplaceResult = {
  name: string;
  devices: {
    name: string;
    type: string;
    status: "written" | "cleared" | "not-in-config" | "running" | "duplicate" | "error";
    typeMismatch?: boolean;
    detail?: string;
  }[];
};

export type ConfigResult<T> = { ok: true; data: T } | { ok: false; errorCode: string; errorMessage: string };

async function configRequest<T>(labId: string, path: string, init?: { method: string; body?: unknown }): Promise<ConfigResult<T>> {
  try {
    const res = await serverFetch(`${getApiBaseUrl()}/labs/${encodeURIComponent(labId)}/configs${path}`, {
      method: init?.method ?? "GET",
      ...(init?.body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string } };
    if (!res.ok) {
      return { ok: false, errorCode: json.error?.code ?? `HTTP_${res.status}`, errorMessage: await apiErrorMessage(json, res.status) };
    }
    return { ok: true, data: json.data as T };
  } catch (err) {
    return { ok: false, errorCode: "NETWORK", errorMessage: err instanceof Error ? err.message : "Network error." };
  }
}

const one = (name: string) => `/${encodeURIComponent(name)}`;

export async function listConfigs(labId: string) {
  return configRequest<{ current: string | null; configs: ConfigInfo[] }>(labId, "");
}

export async function saveConfig(labId: string, name: string, overwrite = false) {
  return configRequest<SaveResult>(labId, "", { method: "POST", body: { name, overwrite } });
}

export async function importConfig(labId: string, name: string, markdown: string, overwrite = false) {
  return configRequest<MatchReport>(labId, "/import", { method: "POST", body: { name, markdown, overwrite } });
}

export async function getConfig(labId: string, name: string) {
  return configRequest<{ name: string; markdown: string; report: MatchReport }>(labId, one(name));
}

export async function updateConfig(labId: string, name: string, markdown: string) {
  return configRequest<{ name: string; report: MatchReport }>(labId, one(name), { method: "PUT", body: { markdown } });
}

export async function deleteConfig(labId: string, name: string) {
  return configRequest<{ deleted: boolean }>(labId, one(name), { method: "DELETE" });
}

/** Replace the startup configurations of the lab's stopped devices with a saved configuration. */
export async function replaceConfig(labId: string, name: string) {
  return configRequest<ReplaceResult>(labId, "/replace", { method: "POST", body: { name } });
}
