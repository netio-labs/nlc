"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { importLab } from "@/actions/labs";

export function ImportLabButton() {
  const t = useTranslations("labs");
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const result = await importLab(parsed);
      if (result.ok) {
        toast.success(t("imported"));
      } else {
        toast.error(result.errorMessage);
      }
    } catch {
      toast.error(t("invalidFile"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={(e) => void handleFileChange(e)} />
      <Button variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? t("importing") : t("import")}
      </Button>
    </>
  );
}
