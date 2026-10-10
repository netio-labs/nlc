"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteLabAction } from "@/actions";

export function DeleteLabButton({ labId }: { labId: string }) {
  const t = useTranslations("labs");
  async function handleDelete() {
    const result = await deleteLabAction(labId);
    if (result.ok) {
      toast.success(t("deleted"));
    } else {
      toast.error(result.errorMessage);
    }
  }

  return (
    <Button size="sm" variant="destructive" className="cursor-pointer" onClick={() => void handleDelete()}>
      {t("delete")}
    </Button>
  );
}
