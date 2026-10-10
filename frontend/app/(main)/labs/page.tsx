import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { fetchLabs } from "@/actions";
import { fetchActiveLabs, type ActiveLabItem } from "@/actions/labs";
import { DeleteLabButton } from "./DeleteLabButton";
import { DuplicateLabButton } from "./DuplicateLabButton";
import { ExportLabButton } from "./ExportLabButton";
import { ImportLabButton } from "./ImportLabButton";
import { StopAllButton } from "./StopAllButton";
import { formatDate } from "@/lib/tools";
import type { LabListItem } from "@/actions/labs";

const PAGE_SIZE = 10;

const viewOptions = [
  { id: "update", url: "/labs" },
  { id: "create", url: "/labs?view=create" },
  { id: "active", url: "/labs?view=active" },
] as const;

interface LabsPageSearchParams {
  view?: string;
  page?: string;
}

function buildUrl(view: string, page: number): string {
  const params = new URLSearchParams();
  if (view !== "update") params.set("view", view);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/labs?${qs}` : "/labs";
}

function isActive(lab: LabListItem): lab is ActiveLabItem {
  return "runningNodes" in lab;
}

export default async function LabsPage({ searchParams }: { searchParams?: Promise<LabsPageSearchParams> }) {
  const params = await Promise.resolve(searchParams);
  const t = await getTranslations("labs");
  const tUpdated = await getTranslations("common.updated");
  const locale = await getLocale();
  const activeView: string = params?.view ?? "update";
  const page = Math.max(1, parseInt(params?.page ?? "1") || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const isActiveView = activeView === "active";
  const { labs, total, errorMessage } = isActiveView
    ? await fetchActiveLabs().then(({ labs, errorMessage }) => ({ labs, total: labs.length, errorMessage }))
    : await fetchLabs(PAGE_SIZE, offset, activeView);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] w-full bg-background">
      <aside className="w-72 shrink-0 border-r border-border bg-muted/70 p-4">
        <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("views.heading")}</p>
        <div className="space-y-1">
          {viewOptions.map((view) => (
            <Button key={view.id} variant={activeView === view.id ? "outline" : "ghost"} className="w-full justify-start text-sm" asChild>
              <Link href={view.url}>{t(`views.${view.id}`)}</Link>
            </Button>
          ))}
        </div>
      </aside>

      <section className="min-w-0 flex-1 border-r border-border px-4 py-4 sm:px-6 sm:py-6">
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
            <div className="flex items-center gap-2">
              <ImportLabButton />
              <Button variant="default" asChild>
                <Link href="/topo-editor">{t("create")}</Link>
              </Button>
            </div>
          </div>

          <div className="overflow-hidden border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
              <p className="text-sm font-medium text-foreground">{t("count", { total })}</p>
              {!isActiveView && <p className="text-xs text-muted-foreground">{t("pageOf", { page, totalPages })}</p>}
            </div>

            {errorMessage ? (
              <div className="space-y-3 p-4">
                <p className="text-sm text-destructive">{errorMessage}</p>
                <Button size="sm" variant="outline" asChild>
                  <Link href={isActiveView ? "/labs?view=active" : "/labs"}>{t("retry")}</Link>
                </Button>
              </div>
            ) : null}

            {!errorMessage && labs.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{isActiveView ? t("noneRunning") : t("noneFound")}</p>
            ) : null}

            {!errorMessage && labs.length > 0 ? (
              <ul>
                {labs.map((lab) => (
                  <li key={lab.id} className="border-b border-border px-4 py-4 last:border-b-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{lab.name || lab.id}</p>
                        {lab.description?.trim() ? (
                          <p className="mt-2 text-sm text-foreground/80">{lab.description}</p>
                        ) : (
                          <p className="mt-2 text-sm text-muted-foreground/70">{t("noDescription")}</p>
                        )}
                        {isActive(lab) ? (
                          <p className="mt-2 text-xs font-medium text-green-600 dark:text-green-500">{t("nodesRunning", { running: lab.runningNodes, total: lab.totalNodes })}</p>
                        ) : (
                          <p className="mt-2 text-xs text-muted-foreground">{formatDate(lab.updatedAt, locale, tUpdated)}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/topo-viewer?id=${lab.id}`}>{t("view")}</Link>
                        </Button>
                        <ExportLabButton labId={lab.id} />
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/topo-editor?id=${lab.id}`}>{t("edit")}</Link>
                        </Button>
                        <DuplicateLabButton labId={lab.id} />
                        {isActive(lab) ? <StopAllButton labId={lab.id} /> : <DeleteLabButton labId={lab.id} />}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {!errorMessage && !isActiveView && (hasPrev || hasNext) ? (
              <div className="flex items-center justify-between border-t border-border bg-muted/50 px-4 py-2">
                <Button size="sm" variant="outline" disabled={!hasPrev} asChild={hasPrev}>
                  {hasPrev ? <Link href={buildUrl(activeView, page - 1)}>{t("previous")}</Link> : <span>{t("previous")}</span>}
                </Button>
                <span className="text-xs text-muted-foreground">{t("page", { page })}</span>
                <Button size="sm" variant="outline" disabled={!hasNext} asChild={hasNext}>
                  {hasNext ? <Link href={buildUrl(activeView, page + 1)}>{t("next")}</Link> : <span>{t("next")}</span>}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
