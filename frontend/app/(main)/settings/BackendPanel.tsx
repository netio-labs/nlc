"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { getBackendConfig, setBackendConfig } from "@/actions/backend";

export function BackendPanel() {
  const t = useTranslations("settings");
  const [saved, setSaved] = useState({ internalUrl: "", publicUrl: "" });
  const [internalUrl, setInternalUrl] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getBackendConfig().then((cfg) => {
      setSaved(cfg);
      setInternalUrl(cfg.internalUrl);
      setPublicUrl(cfg.publicUrl);
    });
  }, []);

  async function handleSave() {
    setBusy(true);
    const result = await setBackendConfig({ internalUrl, publicUrl });
    setBusy(false);
    if (result.ok) {
      setSaved({ internalUrl, publicUrl });
      toast.success(t("backend.saved"));
    } else {
      toast.error(result.error ?? t("backend.saveFailed"));
    }
  }

  const unchanged =
    internalUrl.trim() === saved.internalUrl && publicUrl.trim() === saved.publicUrl;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-foreground">{t("backend.title")}</h1>
      <p className="mb-2 text-sm text-muted-foreground">
        {t("backend.intro")}
      </p>

      <div className="overflow-hidden border border-border bg-card">
        <div className="border-b border-border bg-muted/50 px-4 py-2">
          <p className="text-sm font-medium text-foreground">{t("backend.urls")}</p>
        </div>
        <div className="space-y-4 p-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t("backend.internalUrl")}{" "}
              <span className="font-normal text-muted-foreground/70">
                {t("backend.internalUrlHint")}
              </span>
            </label>
            <Input
              value={internalUrl}
              onChange={(e) => setInternalUrl(e.target.value)}
              placeholder="http://localhost:8080"
              className="font-mono"
            />
            <p className="mt-1.5 text-xs text-muted-foreground/70">
              {t.rich("backend.internalUrlHelp", { mono: (c) => <span className="font-mono">{c}</span> })}
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t("backend.publicUrl")}{" "}
              <span className="font-normal text-muted-foreground/70">
                {t("backend.publicUrlHint")}
              </span>
            </label>
            <Input
              value={publicUrl}
              onChange={(e) => setPublicUrl(e.target.value)}
              placeholder={t("backend.publicUrlPlaceholder")}
              className="font-mono"
            />
            <p className="mt-1.5 text-xs text-muted-foreground/70">
              {t("backend.publicUrlHelp")}
            </p>
          </div>
          <Button onClick={() => void handleSave()} disabled={busy || unchanged}>
            {busy ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
