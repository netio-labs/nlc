"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { listLabCaptures, stopLabCapture, type CaptureInfo } from "@/actions/captures";

const DLT_NAMES: Record<number, string> = { 1: "Ethernet", 9: "PPP", 104: "HDLC", 107: "Frame Relay" };

function parseCapturePort(captureUrl: string): string {
  return captureUrl.match(/:(\d+)$/)?.[1] ?? "???";
}

interface CapturesPanelProps {
  labId: string;
  refreshTrigger?: number;
}

export function CapturesPanel({ labId, refreshTrigger }: CapturesPanelProps) {
  const t = useTranslations("viewer");
  const [captures, setCaptures] = useState<CaptureInfo[]>([]);
  const [stopping, setStopping] = useState<number | null>(null);

  async function refresh() {
    setCaptures(await listLabCaptures(labId));
  }

  useEffect(() => {
    let ignore = false;
    async function run() {
      if (!ignore) await refresh();
    }
    void run();
    return () => {
      ignore = true;
    };
  }, [labId, refreshTrigger]);

  async function handleStop(captureId: number) {
    setStopping(captureId);
    const result = await stopLabCapture(labId, captureId);
    setStopping(null);
    if (result.ok) {
      toast.success(t("captureStopped"));
      void refresh();
    } else {
      toast.error(result.errorMessage);
    }
  }

  if (captures.length === 0) {
    return <p className="mt-4 text-center text-xs text-muted-foreground/70">{t("capturesPanel.empty")}</p>;
  }

  return (
    <div className="mt-3 space-y-2">
      {captures.map((c) => {
        const port = parseCapturePort(c.captureUrl);
        return (
          <div key={c.captureId} className="rounded border border-border p-2 text-xs space-y-1">
            <div className="flex items-center justify-between gap-1">
              <span className="font-mono text-muted-foreground">#{c.captureId} · {DLT_NAMES[c.dlt] ?? `DLT ${c.dlt}`}</span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  onClick={() => window.open(`/capture?labId=${labId}&captureId=${c.captureId}`, `nlc-capture-${c.captureId}`)}
                >
                  {t("view")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 px-2 text-xs"
                  disabled={stopping === c.captureId}
                  onClick={() => void handleStop(c.captureId)}
                >
                  {t("stop")}
                </Button>
              </div>
            </div>
            <p className="truncate text-muted-foreground/70" title={c.linkId}>{t("capturesPanel.link", { id: c.linkId })}</p>
            <p className="text-muted-foreground/70">{t("capturesPanel.port", { port })}</p>
          </div>
        );
      })}
    </div>
  );
}
