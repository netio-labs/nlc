/*
 * Container catalog (backend catalog/container.json): an image's repository name
 * decides its run command, `podman run` options and console shell. The editor
 * copies the matched entry into the node's runtime when the image is picked; the
 * backend only ever reads runtime, so hand-edited lab JSON still takes effect.
 */
import { fetchContainerCatalogEntry } from "@/actions/images";

export const DEFAULT_CATALOG_ID = "default";

export interface ContainerCatalogSummary {
  id: string;
  label: string;
}

/** A local podman image and the catalog entry it matches. */
export interface ContainerImage {
  ref: string;
  catalog: ContainerCatalogSummary;
}

export interface ContainerCatalogEntry extends ContainerCatalogSummary {
  command?: string[];
  runArgs?: string[];
  shell?: string;
  notes?: string;
}

const PARAMS = ["command", "runArgs", "shell"] as const;

// Entries are cached for the page's lifetime; editing the catalog takes effect on reload.
const cache = new Map<string, Promise<{ entry: ContainerCatalogEntry | null; errorMessage: string }>>();

export function loadCatalogEntry(id: string) {
  let p = cache.get(id);
  if (!p) {
    p = fetchContainerCatalogEntry(id).then((r) => {
      if (!r.entry) cache.delete(id); // retry failures next time
      return r;
    });
    cache.set(id, p);
  }
  return p;
}

/** Catalog id for an image: its match among the local images, else the default entry. */
export function catalogIdFor(image: string, images: ContainerImage[]): string {
  return images.find((i) => i.ref === image)?.catalog.id ?? DEFAULT_CATALOG_ID;
}

/** Runtime with the entry's parameters; ones the entry leaves out are removed. */
export function applyCatalogEntry(runtime: Record<string, unknown>, entry: ContainerCatalogEntry): Record<string, unknown> {
  const next: Record<string, unknown> = { ...runtime, catalog: entry.id };
  for (const k of PARAMS) {
    if (entry[k] !== undefined) next[k] = entry[k];
    else delete next[k];
  }
  return next;
}

/** Whether the runtime carries exactly the entry's parameters. */
export function matchesCatalogEntry(runtime: Record<string, unknown>, entry: ContainerCatalogEntry): boolean {
  return PARAMS.every((k) => JSON.stringify(runtime[k]) === JSON.stringify(entry[k]));
}
