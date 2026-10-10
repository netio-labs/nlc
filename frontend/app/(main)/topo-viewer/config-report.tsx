import { useTranslations } from "next-intl";
import type { ReplaceResult, MatchReport, SaveResult } from "@/actions/configs";

type Tone = "ok" | "warn" | "muted" | "error";

const TONE_CLASS: Record<Tone, string> = {
  ok: "text-green-700 dark:text-green-400",
  warn: "text-amber-700 dark:text-amber-400",
  muted: "text-muted-foreground",
  error: "text-destructive",
};

function Row({ name, status, tone, note }: { name: string; status: string; tone: Tone; note?: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-border py-1 text-xs last:border-b-0">
      <span className="font-mono text-foreground">{name}</span>
      <span className={`text-right ${TONE_CLASS[tone]}`}>
        {status}
        {note && <span className="block text-[11px] text-muted-foreground">{note}</span>}
      </span>
    </li>
  );
}

function Names({ label, names, tone }: { label: string; names: string[]; tone: Tone }) {
  const t = useTranslations("viewer.report");
  if (names.length === 0) return null;
  return (
    <p className="text-xs">
      <span className={TONE_CLASS[tone]}>{t("label", { label })}</span>
      <span className="font-mono">{names.join(", ")}</span>
    </p>
  );
}

// Status → tone; the label is viewer.report.save.<status>.
const SAVE_TONE: Record<SaveResult["devices"][number]["status"], Tone> = {
  saved: "ok",
  empty: "warn",
  unreadable: "error",
};

export function SaveReport({ result }: { result: SaveResult }) {
  const t = useTranslations("viewer.report");
  return (
    <div className="space-y-2">
      <ul>
        {result.devices.map((d) => {
          return <Row key={d.name + d.type} name={d.name} status={t(`save.${d.status}`)} tone={SAVE_TONE[d.status]} note={d.detail} />;
        })}
      </ul>
      <Names label={t("duplicatesAmbiguous")} names={result.duplicates} tone="warn" />
    </div>
  );
}

// Status → tone; the label is viewer.report.replace.<status>.
const REPLACE_TONE: Record<ReplaceResult["devices"][number]["status"], Tone> = {
  written: "ok",
  cleared: "ok",
  "not-in-config": "muted",
  running: "warn",
  duplicate: "warn",
  error: "error",
};

export function ReplaceReport({ result }: { result: ReplaceResult }) {
  const t = useTranslations("viewer.report");
  return (
    <ul>
      {result.devices.map((d) => {
        const tone = REPLACE_TONE[d.status];
        const note = d.detail ?? (d.typeMismatch ? t("typeMismatchNote") : undefined);
        return <Row key={d.name + d.type} name={d.name} status={t(`replace.${d.status}`)} tone={d.typeMismatch && tone === "ok" ? "warn" : tone} note={note} />;
      })}
    </ul>
  );
}

export function MatchSummary({ report }: { report: MatchReport }) {
  const t = useTranslations("viewer.report");
  return (
    <div className="space-y-1">
      <p className="text-xs">
        <span className={TONE_CLASS.ok}>{t("label", { label: t("matched") })}</span>
        <span className="font-mono">{report.matched.map((m) => m.name).join(", ") || t("none")}</span>
      </p>
      <Names label={t("typeDiffers")} names={report.matched.filter((m) => m.typeMismatch).map((m) => `${m.name} (${m.type} → ${m.nodeType})`)} tone="warn" />
      <Names label={t("duplicatesSkipped")} names={report.duplicates} tone="warn" />
      <Names label={t("notInLab")} names={report.notInLab} tone="muted" />
      <Names label={t("notInConfig")} names={report.notInConfig} tone="muted" />
    </div>
  );
}
