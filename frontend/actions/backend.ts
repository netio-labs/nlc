"use server";

import { getTranslations } from "next-intl/server";
import { readBackendConfig, writeBackendConfig, type BackendConfig } from "@/lib/backend-config";

export async function getBackendConfig(): Promise<BackendConfig> {
  return readBackendConfig();
}

export async function setBackendConfig(
  config: BackendConfig,
): Promise<{ ok: boolean; error?: string }> {
  const internalUrl = config.internalUrl.trim();
  const publicUrl = config.publicUrl.trim();
  const t = await getTranslations("errors");

  if (!internalUrl) return { ok: false, error: t("internalUrlEmpty") };
  try {
    new URL(internalUrl);
  } catch {
    return { ok: false, error: t("internalUrlInvalid") };
  }
  if (publicUrl) {
    try {
      new URL(publicUrl);
    } catch {
      return { ok: false, error: t("publicUrlInvalid") };
    }
  }

  writeBackendConfig({ internalUrl, publicUrl });
  return { ok: true };
}
