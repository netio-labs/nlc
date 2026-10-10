import fs from "fs";
import path from "path";
import { DOCS_DIR_BY_LOCALE, type Locale } from "@/i18n/config";

/*
 * docs/en is the reference tree; other languages mirror its layout (docs/cn, …).
 * A page missing from a translation falls back to the English one.
 */
const DOCS_ROOT = path.join(process.cwd(), "docs");
const REFERENCE_DIR = path.join(DOCS_ROOT, DOCS_DIR_BY_LOCALE.en);

export type TreeNode = {
  name: string;
  /** First `# ` heading of the page in the current language; the file name if none. */
  title: string;
  path: string; // relative to the language directory
  type: "file" | "dir";
  children?: TreeNode[];
};

/** Absolute path of a page in the locale's directory, falling back to English; null if outside the docs or missing. */
function resolvePage(relativePath: string, locale: Locale): string | null {
  for (const dir of new Set([path.join(DOCS_ROOT, DOCS_DIR_BY_LOCALE[locale]), REFERENCE_DIR])) {
    const full = path.resolve(dir, relativePath);
    if (path.relative(dir, full).startsWith("..")) return null;
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function pageTitle(relativePath: string, locale: Locale): string | undefined {
  const full = resolvePage(relativePath, locale);
  return full ? fs.readFileSync(full, "utf-8").match(/^# (.+)$/m)?.[1].trim() : undefined;
}

export function buildTree(locale: Locale, base: string = ""): TreeNode[] {
  const entries = fs.readdirSync(path.join(REFERENCE_DIR, base), { withFileTypes: true });
  const nodes: TreeNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relativePath = base ? `${base}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const children = buildTree(locale, relativePath);
      if (children.length > 0) nodes.push({ name: entry.name, title: entry.name, path: relativePath, type: "dir", children });
    } else if (entry.name.endsWith(".md")) {
      const name = entry.name.replace(/\.md$/, "");
      nodes.push({ name: entry.name, title: pageTitle(relativePath, locale) ?? name, path: relativePath, type: "file" });
    }
  }

  // dirs first, then files, both alphabetically by file name (numeric prefixes set the order)
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

export function readMarkdownFile(relativePath: string, locale: Locale): string {
  const full = resolvePage(relativePath, locale);
  return full ? fs.readFileSync(full, "utf-8") : `# File not found\n\n\`${relativePath}\``;
}
