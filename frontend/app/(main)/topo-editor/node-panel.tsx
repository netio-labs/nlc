import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CaretRightIcon } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { HostInterface } from "@/actions/host";
import { PROFILES, imageVariant, runtimeFieldsFor, withIoulive86Bind, type IntegerRuntimeFieldDef, type RuntimeFieldDef } from "@/lib/topo/profiles";
import type { FlowNode, FlowNodeData, RuntimeValue } from "@/lib/topo/types";
import {
  DEFAULT_CATALOG_ID,
  applyCatalogEntry,
  loadCatalogEntry,
  matchesCatalogEntry,
  type ContainerCatalogEntry,
  type ContainerImage,
} from "@/lib/topo/container-catalog";

interface NodePanelProps {
  node: FlowNode;
  imagesByProfile: Record<string, string[]>;
  hostInterfaces: HostInterface[];
  containerImages: { images: ContainerImage[]; errorMessage: string };
  /** Copy the image's catalog parameters into a container node (async). */
  applyContainerImage: (nodeId: string, image: string) => void;
  updateNode: (mutator: (data: FlowNodeData) => FlowNodeData) => void;
}

type T = ReturnType<typeof useTranslations<"editor">>;
type Key = Parameters<T>[0];

export function NodePanel({ node, imagesByProfile, hostInterfaces, containerImages, applyContainerImage, updateNode }: NodePanelProps) {
  const t = useTranslations("editor");
  const { nlc } = node.data;
  const profile = PROFILES[nlc.profile];
  const images = imagesByProfile[nlc.profile] ?? [];
  const isContainer = nlc.type === "container";
  const runtimeFields = profile ? runtimeFieldsFor(profile, nlc.image) : {};
  const variant = profile ? imageVariant(profile, nlc.image) : undefined;

  function setNlcField<K extends keyof FlowNodeData["nlc"]>(field: K, value: FlowNodeData["nlc"][K]) {
    updateNode((data) => ({ ...data, nlc: { ...data.nlc, [field]: value } }));
  }

  function setSlotCount(index: number, raw: string) {
    const value = Math.max(0, parseInt(raw, 10) || 0);
    updateNode((data) => {
      const list = [...data.nlc.interfaces];
      if (!list[index]) return data;
      list[index] = { ...list[index], slotCount: value };
      return { ...data, nlc: { ...data.nlc, interfaces: list } };
    });
  }

  // A runtime value still at the old image's default follows the new image's
  // default (e.g. RAM 256 -> 512 for IOL); values the user changed are kept.
  function setImage(image: string) {
    updateNode((data) => {
      const p = PROFILES[data.nlc.profile];
      if (!p) return { ...data, nlc: { ...data.nlc, image } };
      const before = runtimeFieldsFor(p, data.nlc.image);
      const after = runtimeFieldsFor(p, image);
      const runtime = { ...data.nlc.runtime };
      for (const [key, def] of Object.entries(after)) {
        const old = before[key];
        if (def.type === "integer" && old?.type === "integer" && (runtime[key] ?? old.default) === old.default) runtime[key] = def.default;
      }
      return { ...data, nlc: { ...data.nlc, image, runtime } };
    });
    if (isContainer) applyContainerImage(node.id, image);
  }

  function setRuntimeValue(key: string, value: RuntimeValue) {
    updateNode((data) => ({ ...data, nlc: { ...data.nlc, runtime: { ...data.nlc.runtime, [key]: value } } }));
  }

  function setRuntimeInteger(key: string, raw: string, def: IntegerRuntimeFieldDef) {
    setRuntimeValue(key, Math.max(def.min, parseInt(raw, 10) || def.default));
  }

  function renderRuntimeField(key: string, def: RuntimeFieldDef) {
    if (def.type === "select") {
      const current = String(nlc.runtime[key] ?? def.default);
      // "auto" bridges a connected container; the rest are physical host NICs.
      const options = ["auto", ...hostInterfaces.map((iface) => iface.name)];
      if (current && !options.includes(current)) options.unshift(current);
      return (
        <Select value={current} onValueChange={(v) => (nlc.type === "ioulive86" && key === "interface"
          ? updateNode((data) => withIoulive86Bind(data, v))
          : setRuntimeValue(key, v))}>
          <SelectTrigger><SelectValue placeholder={t("nodePanel.selectInterface")} /></SelectTrigger>
          <SelectContent position="item-aligned">
            <SelectGroup>
              {options.map((name) => {
                if (name === "auto") return <SelectItem key="auto" value="auto">{t("nodePanel.autoBridge")}</SelectItem>;
                const info = hostInterfaces.find((iface) => iface.name === name);
                return (
                  <SelectItem key={name} value={name}>
                    {name} ({info ? info.operstate.toLowerCase() : t("nodePanel.notFound")})
                  </SelectItem>
                );
              })}
            </SelectGroup>
          </SelectContent>
        </Select>
      );
    }
    const value = Number(nlc.runtime[key] ?? def.default);
    const recommended = variant?.runtime[key] ? def.default : undefined;
    return (
      <>
        <Input
          type="number" min={def.min}
          value={value}
          onChange={(e) => setRuntimeInteger(key, e.target.value, def)}
        />
        {recommended !== undefined && value < recommended && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t("nodePanel.variantNeeds", { variant: t(`nodePanel.variants.${variant!.id}` as Key), key, min: recommended })}</p>
        )}
      </>
    );
  }

  return (
    <div className="space-y-4">
      {/* Name */}
      <Field label={t("nodePanel.name")}>
        <Input value={nlc.name} onChange={(e) => setNlcField("name", e.target.value)} />
      </Field>

      {/* Image */}
      <Field label={isContainer ? t("nodePanel.containerImage")
        : profile ? t("nodePanel.profileImage", { profile: t(`profiles.${nlc.profile}` as Key) }) : t("nodePanel.image")}>
        {profile?.fixedImage ? (
          <p className="flex h-9 items-center text-sm text-muted-foreground/70">{t("nodePanel.fixed", { value: profile.fixedImage })}</p>
        ) : (() => {
          // Same logic for IOU and container: pick from the profile's available
          // images; keep a previously-saved image selectable even if it is gone;
          // fall back to free text when there are none.
          const opts = nlc.image && !images.includes(nlc.image) ? [nlc.image, ...images] : images;
          return opts.length > 0 ? (
            <Select value={nlc.image} onValueChange={setImage}>
              <SelectTrigger><SelectValue placeholder={t("nodePanel.selectImage")} /></SelectTrigger>
              <SelectContent position="item-aligned">
                <SelectGroup>
                  {opts.map((img) => {
                    const catalog = isContainer ? containerImages.images.find((i) => i.ref === img)?.catalog : undefined;
                    return (
                      <SelectItem key={img} value={img}>
                        {img}
                        {catalog && <span className="ml-1 text-xs text-muted-foreground">· {catalog.label}</span>}
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <Input value={nlc.image} onChange={(e) => setImage(e.target.value)}
                   placeholder={isContainer ? t("nodePanel.containerImagePlaceholder") : t("nodePanel.imageFilename")} />
          );
        })()}
      </Field>

      {/* Container-specific config */}
      {isContainer && <ContainerFields key={node.id} nlc={nlc} containerImages={containerImages} updateNode={updateNode} />}

      {/* Interfaces (non-container; container ports are edited in ContainerFields) */}
      {!isContainer && (
        <div className="space-y-2">
          <FieldLabel>{t("nodePanel.interfaces")}</FieldLabel>
          {nlc.interfaces.length === 0 && <p className="text-xs text-muted-foreground/70">{t("nodePanel.noInterfaces")}</p>}
          {nlc.interfaces.map((iface, i) => (
            <div key={`${iface.family}-${i}`} className="space-y-2 rounded border border-border p-2">
              <p className="text-xs font-medium text-muted-foreground">{iface.family}</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="slotCount">
                  {profile?.fixedInterfaces ? (
                    <p className="flex h-9 items-center text-sm text-muted-foreground/70">{t("nodePanel.fixed", { value: iface.slotCount })}</p>
                  ) : (
                    <Input type="number" min={0} max={16} value={iface.slotCount}
                           onChange={(e) => setSlotCount(i, e.target.value)} />
                  )}
                </Field>
                <Field label="portsPerSlot">
                  <p className="flex h-9 items-center text-sm text-muted-foreground/70">{t("nodePanel.fixed", { value: iface.portsPerSlot })}</p>
                </Field>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Runtime (generic integer/select fields) */}
      {Object.keys(runtimeFields).length > 0 && (
        <div className="space-y-2">
          <FieldLabel>{t("nodePanel.runtime")}</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(runtimeFields).map(([key, def]) => (
              <Field key={key} label={def.label ? t(`nodePanel.runtimeFields.${key}` as Key) : key} className={def.type === "select" ? "col-span-2" : undefined}>
                {renderRuntimeField(key, def)}
              </Field>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Container-specific fields: catalog status, run parameters, ports, addressing ───

type ContainerAddress = { port: number; address?: string; prefix?: number; gateway?: string };

const fmtArgv = (v: unknown) => (Array.isArray(v) ? v.join(" ") : "");

function ContainerFields({ nlc, containerImages, updateNode }: {
  nlc: FlowNodeData["nlc"];
  containerImages: NodePanelProps["containerImages"];
  updateNode: NodePanelProps["updateNode"];
}) {
  const t = useTranslations("editor.nodePanel");
  const ethIdx = nlc.interfaces.findIndex((i) => i.family === "ethernet");
  const ports = ethIdx >= 0 ? nlc.interfaces[ethIdx].portsPerSlot : 1;
  const addresses = (Array.isArray(nlc.runtime.addresses) ? nlc.runtime.addresses : []) as ContainerAddress[];
  const addrFor = (port: number) => addresses.find((a) => a.port === port);

  // The catalog entry this image matches, to show what it implies and spot drift
  // (catalog updated since, or the lab JSON edited by hand).
  const listed = containerImages.images.find((i) => i.ref === nlc.image);
  const catalogId = listed?.catalog.id ?? DEFAULT_CATALOG_ID;
  const [loaded, setLoaded] = useState<{ id: string; entry: ContainerCatalogEntry | null; errorMessage: string } | null>(null);
  useEffect(() => {
    let live = true;
    void loadCatalogEntry(catalogId).then((r) => { if (live) setLoaded({ id: catalogId, ...r }); });
    return () => { live = false; };
  }, [catalogId]);
  const current = loaded?.id === catalogId ? loaded : null;
  const entry = current?.entry ?? null;
  const [showParams, setShowParams] = useState(false);

  function reapply() {
    if (entry) updateNode((d) => ({ ...d, nlc: { ...d.nlc, runtime: applyCatalogEntry(d.nlc.runtime, entry) } }));
  }

  function setPorts(raw: string) {
    const n = Math.max(1, Math.min(16, parseInt(raw, 10) || 1));
    updateNode((d) => {
      const list = [...d.nlc.interfaces];
      const idx = list.findIndex((i) => i.family === "ethernet");
      if (idx >= 0) list[idx] = { ...list[idx], slotCount: 1, portsPerSlot: n };
      const addrs = ((Array.isArray(d.nlc.runtime.addresses) ? d.nlc.runtime.addresses : []) as ContainerAddress[]).filter((a) => a.port < n);
      return { ...d, nlc: { ...d.nlc, interfaces: list, runtime: { ...d.nlc.runtime, addresses: addrs } } };
    });
  }

  function setAddr(port: number, field: "address" | "gateway" | "prefix", value: string) {
    updateNode((d) => {
      const cur = (Array.isArray(d.nlc.runtime.addresses) ? d.nlc.runtime.addresses : []) as ContainerAddress[];
      const existing = cur.find((a) => a.port === port) ?? { port };
      const updated: ContainerAddress = { ...existing };
      if (field === "prefix") updated.prefix = value === "" ? undefined : Math.max(0, Math.min(32, parseInt(value, 10) || 0));
      else updated[field] = value || undefined;
      const next = [...cur.filter((a) => a.port !== port), updated]
        .filter((a) => a.address || a.gateway || a.prefix != null)
        .sort((a, b) => a.port - b.port);
      return { ...d, nlc: { ...d.nlc, runtime: { ...d.nlc.runtime, addresses: next } } };
    });
  }

  return (
    <div className="space-y-3">
      {containerImages.errorMessage && <p className="text-xs text-destructive">{containerImages.errorMessage}</p>}
      {nlc.image && (
        <div className="space-y-1 text-xs">
          <p className={listed && catalogId !== DEFAULT_CATALOG_ID ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>
            {!listed ? t("imageNotLocal")
              : catalogId === DEFAULT_CATALOG_ID ? t("notInCatalog")
              : t("supported", { label: listed.catalog.label })}
          </p>
          {current?.errorMessage && <p className="text-destructive">{current.errorMessage}</p>}
          {entry && !matchesCatalogEntry(nlc.runtime, entry) && (
            <p className="text-amber-700 dark:text-amber-400">
              {t("catalogDrift", { label: entry.label })}{" "}
              <button type="button" className="underline underline-offset-2" onClick={reapply}>{t("reapply")}</button>
            </p>
          )}
        </div>
      )}
      <div>
        <button type="button" onClick={() => setShowParams((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          <CaretRightIcon className={showParams ? "rotate-90 transition-transform" : "transition-transform"} />
          {t("runParameters")}
        </button>
        {showParams && (
          <div className="mt-1 space-y-1 rounded border border-border p-2 font-mono text-xs break-all">
            <ParamRow label={t("command")} value={fmtArgv(nlc.runtime.command) || t("imageEntrypoint")} />
            <ParamRow label={t("runOptions")} value={fmtArgv(nlc.runtime.runArgs) || "—"} />
            <ParamRow label={t("consoleShell")} value={typeof nlc.runtime.shell === "string" ? nlc.runtime.shell : "/bin/sh"} />
            {entry?.notes && <p className="font-sans text-muted-foreground">{entry.notes}</p>}
          </div>
        )}
      </div>
      <Field label={t("ethernetPorts")}>
        <Input type="number" min={1} max={16} value={ports} onChange={(e) => setPorts(e.target.value)} />
      </Field>
      <div className="space-y-2">
        <FieldLabel>{t("interfaceAddressing")}</FieldLabel>
        {Array.from({ length: ports }, (_, port) => {
          const a = addrFor(port);
          return (
            <div key={port} className="space-y-1 rounded border border-border p-2">
              <p className="text-xs font-medium text-muted-foreground">eth{port}</p>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder={t("address")} value={a?.address ?? ""} onChange={(e) => setAddr(port, "address", e.target.value)} />
                <Input type="number" min={0} max={32} placeholder={t("prefix")} value={a?.prefix ?? ""} onChange={(e) => setAddr(port, "prefix", e.target.value)} />
              </div>
              <Input placeholder={t("gatewayOptional")} value={a?.gateway ?? ""} onChange={(e) => setAddr(port, "gateway", e.target.value)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-sans text-muted-foreground">{label}</p>
      <p>{value}</p>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-xs font-medium text-muted-foreground">{children}</p>;
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}
