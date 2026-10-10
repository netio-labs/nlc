import { getTranslations } from "next-intl/server";
import { fetchLabSpec } from "@/actions/labs";
import { getClientWsBaseUrl } from "@/lib/backend-config";
import { ConsoleView } from "./console-view";

export default async function ConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id: labId } = await searchParams;
  const t = await getTranslations("console.page");

  const empty = (msg: string) => (
    <div className="flex h-[calc(100vh-4rem)] items-center justify-center bg-zinc-900 text-sm text-zinc-500">
      {msg}
    </div>
  );

  if (!labId) return empty(t("noLab"));

  const spec = await fetchLabSpec(labId);
  if (!spec) return empty(t("notFound"));

  const nodes = spec.nodes.map((n) => ({ id: n.id, name: n.name }));
  return <ConsoleView labId={labId} nodes={nodes} wsBaseUrl={getClientWsBaseUrl()} />;
}
