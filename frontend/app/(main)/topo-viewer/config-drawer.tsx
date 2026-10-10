"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { XIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteConfig, getConfig, updateConfig, type MatchReport } from "@/actions/configs";
import { MatchSummary } from "./config-report";

const MD_COMPONENTS: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: ({ children }) => <h1 className="mb-3 text-xl font-bold text-foreground">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-6 border-b border-border pb-1 text-lg font-semibold text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-4 font-semibold text-foreground">{children}</h3>,
  p: ({ children }) => <p className="mb-3 text-sm leading-6 text-foreground/80">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 ml-5 list-disc text-sm text-foreground/80">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 ml-5 list-decimal text-sm text-foreground/80">{children}</ol>,
  pre: ({ children }) => <pre className="mb-3 overflow-x-auto rounded border border-border bg-muted/50 p-3 text-xs leading-5">{children}</pre>,
  code: ({ className, children }) =>
    className ? <code className="font-mono">{children}</code> : <code className="rounded bg-muted px-1 font-mono text-xs">{children}</code>,
};

function download(name: string, markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name}.md` });
  a.click();
  URL.revokeObjectURL(url);
}

interface ConfigDrawerProps {
  labId: string;
  name: string;
  /** The lab's devices currently come from this configuration. */
  isCurrent: boolean;
  onClose: () => void;
  /** The configuration was edited or deleted: the list needs refreshing. */
  onChanged: () => void;
}

export function ConfigDrawer({ labId, name, isCurrent, onClose, onChanged }: ConfigDrawerProps) {
  const t = useTranslations("viewer.drawer");
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [report, setReport] = useState<MatchReport | null>(null);
  const [draft, setDraft] = useState<string | null>(null); // non-null while editing
  const [busy, setBusy] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const dirty = draft !== null && draft !== markdown;

  useEffect(() => {
    // Mounted once per configuration (the parent keys it by name), so state starts fresh.
    let cancelled = false;
    void getConfig(labId, name).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setMarkdown(res.data.markdown);
        setReport(res.data.report);
      } else {
        toast.error(res.errorMessage);
        onClose();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [labId, name]); // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    if (dirty && !window.confirm(t("discard"))) return;
    onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc inside a modal (delete confirmation) only closes that modal.
      if (e.key === "Escape" && !(e.target instanceof Element && e.target.closest("[role=dialog]"))) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function save() {
    if (draft === null) return;
    setBusy(true);
    const res = await updateConfig(labId, name, draft);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.errorMessage);
      return;
    }
    setMarkdown(draft);
    setReport(res.data.report);
    setDraft(null);
    toast.success(t("saved", { name }));
    onChanged();
  }

  async function remove() {
    setDeleteConfirming(false);
    setBusy(true);
    const res = await deleteConfig(labId, name);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.errorMessage);
      return;
    }
    toast.success(t("deleted", { name }));
    onChanged();
    onClose();
  }

  return (
    <div className="fixed bottom-0 right-0 top-16 z-40 flex w-[min(760px,92vw)] flex-col border-l border-border bg-card shadow-2xl">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <p className="min-w-0 truncate text-sm font-semibold text-foreground" title={name}>{name}</p>
        {isCurrent && <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">{t("current")}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {draft === null ? (
            <Button size="sm" variant="outline" disabled={markdown === null} onClick={() => setDraft(markdown)}>{t("edit")}</Button>
          ) : (
            <>
              <Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>{busy ? t("saving") : t("save")}</Button>
              <Button size="sm" variant="outline" onClick={() => (!dirty || window.confirm(t("discard"))) && setDraft(null)}>{t("cancel")}</Button>
            </>
          )}
          <Button size="sm" variant="outline" disabled={markdown === null} onClick={() => download(name, draft ?? markdown ?? "")}>{t("download")}</Button>
          <Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={() => setDeleteConfirming(true)}>{t("delete")}</Button>
          <Button size="icon" variant="ghost" aria-label={t("close")} onClick={close}><XIcon className="size-4" /></Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {markdown === null ? (
          <p className="p-4 text-sm text-muted-foreground">{t("loading")}</p>
        ) : draft !== null ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="h-full w-full resize-none bg-transparent p-4 font-mono text-xs leading-5 text-foreground outline-none"
          />
        ) : (
          <div className="p-4">
            {report && (
              <div className="mb-4 rounded border border-border bg-muted/40 p-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground">{t("againstLab")}</p>
                <MatchSummary report={report} />
              </div>
            )}
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{markdown}</ReactMarkdown>
          </div>
        )}
      </div>

      <ConfirmDialog open={deleteConfirming} onOpenChange={setDeleteConfirming} destructive busy={busy}
        title={t("deleteTitle")}
        description={t("deleteDescription", { name })}
        confirmLabel={t("delete")}
        onConfirm={() => void remove()} />
    </div>
  );
}
