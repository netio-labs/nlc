import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { ImagesPanel } from "./ImagesPanel";
import { RuntimePanel } from "./RuntimePanel";
import { BackendPanel } from "./BackendPanel";
import { ShellPanel } from "./ShellPanel";
import { getClientWsBaseUrl } from "@/lib/backend-config";

const SECTIONS = ["images", "runtime", "backend", "shell"] as const;

type Section = (typeof SECTIONS)[number];

interface SettingsPageSearchParams {
  section?: string;
}

export default async function SettingsPage({ searchParams }: { searchParams?: Promise<SettingsPageSearchParams> }) {
  const params = await Promise.resolve(searchParams);
  const section = ((params?.section ?? "images") as Section);
  const t = await getTranslations("settings");

  return (
    <div className="flex min-h-[calc(100vh-4rem)] w-full bg-background">
      <aside className="w-72 shrink-0 border-r border-border bg-muted/70 p-4">
        <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("heading")}</p>
        <div className="space-y-1">
          {SECTIONS.map((s) => (
            <Button
              key={s}
              variant={section === s ? "outline" : "ghost"}
              className="w-full justify-start text-sm"
              asChild
            >
              <Link href={`/settings?section=${s}`}>{t(`sections.${s}`)}</Link>
            </Button>
          ))}
        </div>
      </aside>

      <section className="min-w-0 flex-1 border-r border-border px-4 py-4 sm:px-6 sm:py-6">
        {section === "shell" ? (
          <ShellPanel wsBaseUrl={getClientWsBaseUrl()} />
        ) : section === "runtime" ? (
          <RuntimePanel />
        ) : section === "backend" ? (
          <BackendPanel />
        ) : (
          <ImagesPanel />
        )}
      </section>
    </div>
  );
}
