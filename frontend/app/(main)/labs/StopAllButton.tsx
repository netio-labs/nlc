"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { stopAllNodesAction } from "@/actions/nodes";

export function StopAllButton({ labId }: { labId: string }) {
  const t = useTranslations("labs");
  const [busy, setBusy] = useState(false);

  async function handleStopAll() {
    setBusy(true);
    const result = await stopAllNodesAction(labId);
    setBusy(false);
    if (result.ok) {
      toast.success(t("allStopped"));
    } else {
      toast.error(result.errorMessage);
    }
  }

  return (
    <Button size="sm" variant="destructive" disabled={busy} onClick={() => void handleStopAll()}>
      {busy ? t("stopping") : t("stopAll")}
    </Button>
  );
}
