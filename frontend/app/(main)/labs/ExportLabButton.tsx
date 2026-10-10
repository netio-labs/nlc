"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchLabSpec } from "@/actions/labs";

export function ExportLabButton({ labId }: { labId: string }) {
  const t = useTranslations("labs");
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try {
      const spec = await fetchLabSpec(labId);
      if (!spec) {
        toast.error(t("exportFailed"));
        return;
      }
      const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${labId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleExport()}>
      {busy ? t("exporting") : t("export")}
    </Button>
  );
}
