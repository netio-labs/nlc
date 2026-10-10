import { getTranslations } from "next-intl/server";
import { fetchLabSpec } from "@/actions";
import { getClientWsBaseUrl } from "@/lib/backend-config";
import { CaptureViewer } from "./capture-viewer";

interface CapturePageSearchParams {
  labId?: string;
  captureId?: string;
}

export default async function CapturePage({ searchParams }: { searchParams?: Promise<CapturePageSearchParams> }) {
  const params = await Promise.resolve(searchParams);
  const labId = params?.labId ?? "";
  const captureId = Number(params?.captureId ?? "0");

  if (!labId || !captureId) {
    const t = await getTranslations("capture");
    return <p className="p-8 text-sm text-destructive">{t("missingParams")}</p>;
  }

  const spec = await fetchLabSpec(labId);
  const labName = spec?.lab.name || labId;

  return (
    <div className="h-[calc(100vh-4rem)] overflow-hidden bg-zinc-950">
      <CaptureViewer labId={labId} captureId={captureId} labName={labName} wsBaseUrl={getClientWsBaseUrl()} />
    </div>
  );
}
