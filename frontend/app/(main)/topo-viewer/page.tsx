import { getTranslations } from "next-intl/server";
import { fetchLabSpec } from "@/actions";
import { TopoViewer } from "./viewer";

interface TopoViewerPageProps {
  searchParams?: Promise<{ id?: string }>;
}

export default async function TopoViewerPage({ searchParams }: TopoViewerPageProps) {
  const params = await Promise.resolve(searchParams);
  const labId = params?.id;
  const t = await getTranslations("viewer.page");
  if (!labId) return <p className="p-8 text-sm text-muted-foreground">{t("noLabId")}</p>;
  const spec = await fetchLabSpec(labId);
  if (!spec) return <p className="p-8 text-sm text-destructive">{t("notFound")}</p>;
  return <TopoViewer spec={spec} />;
}
