"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { getIouKey, setIouKey } from "@/actions/images";

export function RuntimePanel() {
  const t = useTranslations("settings");
  const [hostname, setHostname] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getIouKey().then((result) => {
      if (result.errorMessage) {
        toast.error(result.errorMessage);
      } else {
        setHostname(result.hostname ?? "");
        setSavedKey(result.key ?? "");
        setInputValue(result.key ?? "");
      }
      setLoading(false);
    });
  }, []);

  async function handleSave() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setSaving(true);
    const result = await setIouKey(trimmed);
    setSaving(false);
    if (result.ok) {
      setSavedKey(trimmed);
      toast.success(t("runtime.keySaved"));
    } else {
      toast.error(result.errorMessage);
    }
  }

  const unchanged = inputValue.trim() === savedKey;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("runtime.title")}</h1>
      </div>

      <div className="overflow-hidden border border-border bg-card">
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">{t("loading")}</p>
        ) : (
          <div className="divide-y divide-border">
            <div className="px-4 py-4">
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t("runtime.hostname")}</p>
              <p className="font-mono text-sm text-foreground">{hostname || "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground/70">{t("runtime.hostnameHint")}</p>
            </div>

            <div className="px-4 py-4">
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t("runtime.currentKey")}</p>
              {savedKey ? (
                <p className="font-mono text-sm text-foreground">{savedKey}</p>
              ) : (
                <p className="text-sm text-muted-foreground/70">{t("runtime.notSet")}</p>
              )}
            </div>

            <div className="px-4 py-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">{t("runtime.updateKey")}</p>
              <div className="flex gap-2">
                <Input
                  className="font-mono text-sm"
                  placeholder={t("runtime.keyPlaceholder")}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !unchanged) void handleSave(); }}
                />
                <Button
                  disabled={saving || !inputValue.trim() || unchanged}
                  onClick={() => void handleSave()}
                >
                  {saving ? t("saving") : t("save")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
