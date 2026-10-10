"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/tools";
import { TopoThumbnail } from "@/app/TopoThumbnail";
import { fetchLabCards, type LabCard, type LabListItem } from "@/actions/labs";
import type { LabSpecV2 } from "@/lib/topo/types";

const PAGE = 20;

export function LabGrid({ initialCards, total }: { initialCards: LabCard[]; total: number }) {
  const t = useTranslations("home");
  const [cards, setCards] = useState<LabCard[]>(initialCards);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialCards.length >= total);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    if (loading || done) return;
    setLoading(true);
    try {
      const { cards: next, total: t } = await fetchLabCards(cards.length, PAGE);
      setCards((prev) => {
        const merged = [...prev, ...next];
        if (next.length === 0 || merged.length >= t) setDone(true);
        return merged;
      });
    } catch {
      // transient failure — the observer will retry when the sentinel re-enters view
    } finally {
      setLoading(false);
    }
  }, [cards.length, loading, done]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || done) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void loadMore();
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, done]);

  if (cards.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-sm text-muted-foreground/70">{t("empty")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {cards.map(({ lab, spec }) => (
          <LabCardView key={lab.id} lab={lab} spec={spec} />
        ))}
      </div>
      {!done && <div ref={sentinelRef} className="h-10" />}
      {loading && <p className="py-6 text-center text-xs text-muted-foreground/70">{t("loading")}</p>}
    </>
  );
}

function LabCardView({ lab, spec }: { lab: LabListItem; spec: LabSpecV2 | null }) {
  const locale = useLocale();
  const tUpdated = useTranslations("common.updated");
  return (
    <Link href={`/topo-viewer?id=${lab.id}`} className="group block">
      <div className="overflow-hidden rounded-lg border border-border transition-shadow hover:shadow-md">
        <div className="aspect-video overflow-hidden bg-muted/50">
          <TopoThumbnail spec={spec} />
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5">
          <NodeCountBadge spec={spec} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground leading-tight">
              {lab.name || lab.id}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground/70">{formatDate(lab.updatedAt, locale, tUpdated)}</p>
          </div>
        </div>
      </div>
    </Link>
  );
}

function NodeCountBadge({ spec }: { spec: LabSpecV2 | null }) {
  const count = spec?.nodes.length ?? 0;
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted text-xs font-semibold text-muted-foreground">
      {count}
    </div>
  );
}
