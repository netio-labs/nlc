"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { listImages, deleteImage, uploadImage } from "@/actions/images";

function imageProfile(name: string): "switch" | "router" {
  return name.startsWith("I86BI_LINUX_L2") ? "switch" : "router";
}

export function ImagesPanel() {
  const t = useTranslations("settings");
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingSet, setDeletingSet] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const result = await listImages();
    if (result.errorMessage) toast.error(result.errorMessage);
    else setImages(result.images);
    setLoading(false);
  }

  useEffect(() => {
    let ignore = false;
    async function run() {
      if (!ignore) await load();
    }
    void run();
    return () => {
      ignore = true;
    };
  }, []);

  async function handleDelete(name: string) {
    setDeletingSet((prev) => new Set(prev).add(name));
    const result = await deleteImage(name);
    setDeletingSet((prev) => {
      const s = new Set(prev);
      s.delete(name);
      return s;
    });
    if (result.ok) {
      setImages((prev) => prev.filter((i) => i !== name));
      toast.success(t("images.deleted", { name }));
    } else {
      toast.error(result.errorMessage);
    }
  }

  async function handleUpload(file: File) {
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file, file.name);
    const result = await uploadImage(formData);
    if (result.ok) {
      toast.success(t("images.uploaded", { name: file.name }));
      await load();
    } else {
      toast.error(result.errorMessage);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("images.title")}</h1>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
            }}
          />
          <Button disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            {uploading ? t("images.uploading") : t("images.upload")}
          </Button>
        </div>
      </div>

      <div className="mb-3 text-sm text-muted-foreground flex flex-col gap-2">
        <p>{t("images.intro")}</p>
        <ul className="ml-5 list-disc space-y-0.5">
          <li>
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground/80">I86BI_LINUX</code> {t("images.routers")}
          </li>
          <li>
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground/80">I86BI_LINUX_L2</code> {t("images.switches")}
          </li>
        </ul>
        <p>
          {t.rich("images.rejected", {
            link: (c) => (
              <Link href="/docs?file=guide/01-getting-started.md" className="text-blue-600 hover:underline dark:text-blue-400">
                {c}
              </Link>
            ),
          })}
        </p>
      </div>

      <div className="overflow-hidden border border-border bg-card">
        <div className="border-b border-border bg-muted/50 px-4 py-2">
          <p className="text-sm font-medium text-foreground">{t("images.count", { count: images.length })}</p>
        </div>

        {loading && <p className="p-4 text-sm text-muted-foreground">{t("loading")}</p>}
        {!loading && images.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("images.empty")}</p>}
        {!loading && images.length > 0 && (
          <ul>
            {images.map((name) => (
              <li key={name} className="flex items-center justify-between border-b border-border px-4 py-3 last:border-b-0">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-foreground">{name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{t(`images.${imageProfile(name)}`)}</p>
                </div>
                <Button size="sm" variant="destructive" disabled={deletingSet.has(name)} onClick={() => void handleDelete(name)}>
                  {deletingSet.has(name) ? t("images.deleting") : t("images.delete")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
