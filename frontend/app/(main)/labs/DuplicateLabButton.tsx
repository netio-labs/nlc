"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { duplicateLab } from "@/actions/labs";

export function DuplicateLabButton({ labId }: { labId: string }) {
  const t = useTranslations("labs");
  const [busy, setBusy] = useState(false);

  async function handleDuplicate() {
    setBusy(true);
    const result = await duplicateLab(labId);
    setBusy(false);
    if (result.ok) {
      toast.success(t("duplicated"));
    } else {
      toast.error(result.errorMessage);
    }
  }

  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleDuplicate()}>
      {busy ? t("duplicating") : t("duplicate")}
    </Button>
  );
}
