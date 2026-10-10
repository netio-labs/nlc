/** Translator for the `common.updated` messages (from useTranslations or getTranslations). */
type UpdatedT = (key: "unavailable" | "justNow" | "relative", values?: { time: string }) => string;

export function formatDate(lastModifiedAt: number, locale: string, t: UpdatedT): string {
  if (!Number.isFinite(lastModifiedAt)) return t("unavailable");

  const diffMs = lastModifiedAt - Date.now();
  const absDiffMs = Math.abs(diffMs);

  if (absDiffMs < 60_000) return t("justNow");

  const relativeTime = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const units: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
    { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
    { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
    { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
    { unit: "day", ms: 24 * 60 * 60 * 1000 },
    { unit: "hour", ms: 60 * 60 * 1000 },
    { unit: "minute", ms: 60 * 1000 },
  ];

  for (const { unit, ms } of units) {
    if (absDiffMs >= ms) {
      return t("relative", { time: relativeTime.format(Math.round(diffMs / ms), unit) });
    }
  }

  return t("justNow");
}
