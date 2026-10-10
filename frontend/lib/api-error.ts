import { getTranslations } from "next-intl/server";

type ErrorBody = { error?: { code?: string; message?: string } } | null | undefined;
type ErrorKey = Parameters<Awaited<ReturnType<typeof getTranslations<"errors">>>>[0];

/**
 * Text for a failed backend call, in the user's language. Codes with a fixed meaning
 * (messages/<locale>/errors.json) are translated; the rest keep the backend's own
 * message, whose details (podman stderr, the offending field, …) matter more than its
 * language.
 */
export async function apiErrorMessage(body: ErrorBody, status: number): Promise<string> {
  const code = body?.error?.code as ErrorKey | undefined;
  const t = await getTranslations("errors");
  if (code && t.has(code)) return t(code);
  return body?.error?.message ?? `HTTP ${status}`;
}
