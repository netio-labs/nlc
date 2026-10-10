"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  replaceConfig,
  importConfig,
  listConfigs,
  saveConfig,
  type ConfigResult,
  type ConfigInfo,
} from "@/actions/configs";
import { ConfigDrawer } from "./config-drawer";
import { ReplaceReport, MatchSummary, SaveReport } from "./config-report";

type NameDialog =
  | { kind: "save"; name: string; overwrite: boolean }
  | { kind: "import"; name: string; overwrite: boolean; markdown: string };

/**
 * Saved device configurations of the lab: pick one and replace the stopped
 * devices' startup configurations with it, save / import configurations, and open one in the side
 * drawer to preview or edit. The dropdown marks the current one (last replaced in).
 */
export function ConfigsSection({ labId, isLoaded }: { labId: string; isLoaded: boolean }) {
  const t = useTranslations("viewer.configs");
  const [configs, setConfigs] = useState<ConfigInfo[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [report, setReport] = useState<{ title: string; body: React.ReactNode } | null>(null);
  const [replaceConfirming, setReplaceConfirming] = useState(false);
  const [drawer, setDrawer] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh(select?: string) {
    const res = await listConfigs(labId);
    if (!res.ok) {
      toast.error(res.errorMessage);
      return;
    }
    setConfigs(res.data.configs);
    setCurrent(res.data.current);
    const names = res.data.configs.map((v) => v.name);
    setSelected((cur) => (select && names.includes(select) ? select : names.includes(cur) ? cur : (res.data.current ?? names[0] ?? "")));
  }

  useEffect(() => {
    void refresh();
  }, [labId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run<T>(fn: () => Promise<ConfigResult<T>>): Promise<T | null> {
    setBusy(true);
    try {
      const res = await fn();
      if (res.ok) return res.data;
      if (res.errorCode === "CONFIG_EXISTS" && nameDialog) {
        setNameDialog({ ...nameDialog, overwrite: true });   // ask to confirm overwriting
        return null;
      }
      toast.error(res.errorMessage);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submitName() {
    if (!nameDialog) return;
    const { name, overwrite } = nameDialog;
    if (nameDialog.kind === "save") {
      const result = await run(() => saveConfig(labId, name, overwrite));
      if (!result) return;
      setNameDialog(null);
      await refresh(result.name);
      setReport({ title: t("savedReport", { name: result.name }), body: <SaveReport result={result} /> });
    } else {
      const { markdown } = nameDialog;
      const result = await run(() => importConfig(labId, name, markdown, overwrite));
      if (!result) return;
      setNameDialog(null);
      await refresh(name.trim().replace(/\.md$/i, "").trim());
      setReport({ title: t("importedReport", { name }), body: <MatchSummary report={result} /> });
    }
  }

  async function onFileChosen(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    setNameDialog({ kind: "import", name: file.name.replace(/\.md$/i, ""), overwrite: false, markdown: await file.text() });
  }

  async function replace() {
    setReplaceConfirming(false);
    const result = await run(() => replaceConfig(labId, selected));
    if (!result) return;
    await refresh();
    setReport({ title: t("replacedReport", { name: result.name }), body: <ReplaceReport result={result} /> });
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{t("heading")}</p>

      {configs.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">{t("empty")}</p>
      ) : (
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="w-full"><SelectValue placeholder={t("selectPlaceholder")} /></SelectTrigger>
          <SelectContent>
            {configs.map((c) => (
              <SelectItem key={c.name} value={c.name}>
                {c.name}{c.name === current ? t("currentSuffix") : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || !isLoaded} title={isLoaded ? t("saveTitle") : t("loadFirst")}
          onClick={() => setNameDialog({ kind: "save", name: "", overwrite: false })}>
          {t("save")}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>{t("import")}</Button>
        {configs.length > 0 && (
          <>
            <Button size="sm" variant="outline" disabled={busy || !isLoaded || !selected} onClick={() => setReplaceConfirming(true)}
              title={isLoaded ? t("replaceTitle") : t("loadFirst")}>
              {t("replace")}
            </Button>
            <Button size="sm" variant="outline" disabled={!selected} onClick={() => setDrawer(selected)}>{t("view")}</Button>
          </>
        )}
        <input ref={fileInput} type="file" accept=".md,text/markdown,text/plain" className="hidden" onChange={(e) => void onFileChosen(e.target.files?.[0])} />
      </div>

      <ConfirmDialog open={replaceConfirming} onOpenChange={setReplaceConfirming} busy={busy}
        title={t("replaceDialogTitle")}
        description={t.rich("replaceDescription", { name: selected, br: () => <br /> })}
        confirmLabel={t("replace")}
        onConfirm={() => void replace()} />

      <Dialog open={nameDialog !== null} onOpenChange={(open) => !open && setNameDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{nameDialog?.kind === "import" ? t("importDialogTitle") : t("saveDialogTitle")}</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submitName(); }}>
            {nameDialog?.kind === "save" && (
              <p className="text-xs text-muted-foreground">
                {t("saveDialogHint")}
              </p>
            )}
            <Input autoFocus placeholder={t("namePlaceholder")} value={nameDialog?.name ?? ""}
              onChange={(e) => nameDialog && setNameDialog({ ...nameDialog, name: e.target.value, overwrite: false })} />
            {nameDialog?.overwrite && <p className="text-xs text-amber-700 dark:text-amber-400">{t("exists")}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNameDialog(null)}>{t("cancel")}</Button>
              <Button type="submit" disabled={busy || !nameDialog?.name.trim()}>
                {busy ? t("working") : nameDialog?.overwrite ? t("overwrite") : nameDialog?.kind === "import" ? t("import") : t("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={report !== null} onOpenChange={(open) => !open && setReport(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{report?.title}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">{report?.body}</div>
          <DialogFooter>
            <Button onClick={() => setReport(null)}>{t("close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {drawer && (
        <ConfigDrawer key={drawer} labId={labId} name={drawer} isCurrent={drawer === current} onClose={() => setDrawer(null)} onChanged={() => void refresh()} />
      )}
    </div>
  );
}
