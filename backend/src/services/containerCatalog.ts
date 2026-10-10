/*
 * Container catalog: which `podman run` command / options / console shell an image
 * needs, keyed by its repository name (catalog/container.json).
 *
 * The file is read on every request so that adding an image is just an edit.
 * Entries are tried in order and the first whose `match` globs hit wins; images
 * nothing matches get the mandatory `default` entry. The editor copies the matched
 * entry into the node's runtime — starting a node never consults the catalog.
 */
import fs from "node:fs";
import { CONFIG } from "../config.ts";
import { appError } from "./errors.ts";

export interface ContainerCatalogEntry {
  id: string;
  label: string;
  /** Globs (`*` only) matched against the normalized repository name. */
  match?: string[];
  /** Omitted: use the image's own entrypoint. */
  command?: string[];
  runArgs?: string[];
  /** Omitted: the backend default (/bin/sh). */
  shell?: string;
  notes?: string;
}

export const DEFAULT_CATALOG_ID = "default";

const ID = /^[a-z0-9][a-z0-9_-]*$/;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === "string");
}

/** Validate the catalog file's contents; throws CONTAINER_CATALOG_INVALID naming the bad entry/field. */
export function parseContainerCatalog(raw: unknown): ContainerCatalogEntry[] {
  const invalid = (msg: string) => appError("CONTAINER_CATALOG_INVALID", `container catalog: ${msg}`);
  if (!Array.isArray(raw)) throw invalid("top level must be an array");
  const seen = new Set<string>();
  const entries = raw.map((e: unknown, i): ContainerCatalogEntry => {
    if (!e || typeof e !== "object" || Array.isArray(e)) throw invalid(`entry #${i} must be an object`);
    const o = e as Record<string, unknown>;
    const where = typeof o.id === "string" ? `entry "${o.id}"` : `entry #${i}`;
    if (typeof o.id !== "string" || !ID.test(o.id)) throw invalid(`${where}: id must match ${ID}`);
    if (seen.has(o.id)) throw invalid(`${where}: duplicate id`);
    seen.add(o.id);
    if (typeof o.label !== "string" || !o.label.trim()) throw invalid(`${where}: label must be a non-empty string`);
    for (const k of ["match", "command", "runArgs"] as const) {
      if (o[k] !== undefined && !isStringArray(o[k])) throw invalid(`${where}: ${k} must be an array of strings`);
    }
    for (const k of ["shell", "notes"] as const) {
      if (o[k] !== undefined && typeof o[k] !== "string") throw invalid(`${where}: ${k} must be a string`);
    }
    if (o.id === DEFAULT_CATALOG_ID && o.match !== undefined) throw invalid(`${where}: the default entry takes no match`);
    if (o.id !== DEFAULT_CATALOG_ID && !(o.match as string[] | undefined)?.length) throw invalid(`${where}: match must not be empty`);
    return o as unknown as ContainerCatalogEntry;
  });
  if (!seen.has(DEFAULT_CATALOG_ID)) throw invalid(`a "${DEFAULT_CATALOG_ID}" entry is required`);
  return entries;
}

export function loadContainerCatalog(): ContainerCatalogEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG.containerCatalog, "utf8"));
  } catch (err) {
    throw appError("CONTAINER_CATALOG_INVALID", `container catalog: cannot read ${CONFIG.containerCatalog}: ${(err as Error).message}`);
  }
  return parseContainerCatalog(raw);
}

/**
 * Repository name without registry, `library/`, tag or digest, lower-cased:
 *   docker.io/library/alpine:3 → alpine, quay.io/frrouting/frr:10.1 → frrouting/frr,
 *   localhost/ceos:4.32 → ceos, reg:5000/a/b@sha256:… → a/b
 */
export function normalizeRepo(ref: string): string {
  let repo = ref.trim().toLowerCase().split("@")[0];
  const colon = repo.lastIndexOf(":");
  if (colon > repo.lastIndexOf("/")) repo = repo.slice(0, colon);
  const parts = repo.split("/");
  if (parts.length > 1 && (parts[0].includes(".") || parts[0].includes(":") || parts[0] === "localhost")) parts.shift();
  if (parts.length > 1 && parts[0] === "library") parts.shift();
  return parts.join("/");
}

function globToRegExp(glob: string): RegExp {
  const body = glob.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}$`, "i");
}

/** First entry whose globs match the image's repository name, else the default entry. */
export function matchContainerCatalog(catalog: ContainerCatalogEntry[], ref: string): ContainerCatalogEntry {
  const repo = normalizeRepo(ref);
  return catalog.find((e) => e.match?.some((g) => globToRegExp(g).test(repo)))
    ?? catalog.find((e) => e.id === DEFAULT_CATALOG_ID)!;
}
