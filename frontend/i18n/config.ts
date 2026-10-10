/*
 * UI languages. The choice lives in a cookie (no /zh URL prefix); without one the
 * browser's Accept-Language decides, falling back to English.
 */
export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "NLC_LOCALE";

/** Directory under docs/ holding each language's Markdown. */
export const DOCS_DIR_BY_LOCALE: Record<Locale, string> = { en: "en", zh: "cn" };

export function isLocale(v: unknown): v is Locale {
  return LOCALES.includes(v as Locale);
}

/** First supported language in an Accept-Language header, by q-value. */
export function localeFromAcceptLanguage(header: string | null): Locale {
  const tags = (header ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().toLowerCase().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag, q: q ? Number(q.slice(2)) || 0 : 1 };
    })
    .filter((t) => t.tag && t.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of tags) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
