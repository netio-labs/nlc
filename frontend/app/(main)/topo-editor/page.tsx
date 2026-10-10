import { fetchLabSpec } from "@/actions";
import { TopoEditor } from "./editor";

interface TopoEditorPageProps {
  searchParams?: Promise<{ id?: string }>;
}

export default async function TopoEditorPage({ searchParams }: TopoEditorPageProps) {
  const params = await Promise.resolve(searchParams);
  const labId = params?.id;
  const initialSpec = labId ? await fetchLabSpec(labId) : undefined;
  return <TopoEditor initialSpec={initialSpec ?? undefined} isExisting={!!initialSpec} />;
}
