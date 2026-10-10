"use server";

import { getApiBaseUrl } from "../lib/backend-config";
import { serverFetch } from "../lib/auth";
import { apiErrorMessage } from "../lib/api-error";

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; errorMessage: string }> {
  try {
    const response = await serverFetch(`${getApiBaseUrl()}/user/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!response.ok) {
      const err = (await response.json()) as { error?: { message?: string } };
      throw new Error(await apiErrorMessage(err, response.status));
    }
    return { ok: true, errorMessage: "" };
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : "Change password failed." };
  }
}
