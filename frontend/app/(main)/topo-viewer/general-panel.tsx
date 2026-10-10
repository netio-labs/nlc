"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { fetchLabNodes, loadLab, unloadLab, type LabNodeStatus } from "@/actions";
import { startNode, stopNode, resetNode, wipeNode, startAllNodes, stopAllNodes } from "@/actions/nodes";
import { listLabCaptures, startLabCapture, stopLabCapture, type CaptureInfo } from "@/actions/captures";
import type { FlowEdge, FlowNode } from "@/lib/topo/types";
import { ConfigsSection } from "./configs-section";

const DLT_OPTIONS = [
  { value: "ethernet", label: "Ethernet" },
  { value: "ppp", label: "PPP" },
  { value: "hdlc", label: "HDLC" },
  { value: "framrelay", label: "Frame Relay" },
] as const;

function parseCapturePort(captureUrl: string): string {
  return captureUrl.match(/:(\d+)$/)?.[1] ?? "???";
}

interface GeneralPanelProps {
  labId: string;
  selectedNode: FlowNode | null;
  selectedEdge: FlowEdge | null;
  selectedEdgePeers: FlowEdge[];
  onSelectEdge: (id: string) => void;
  refreshTrigger?: number;
  onCaptureChange?: () => void;
}

export function GeneralPanel({ labId, selectedNode, selectedEdge, selectedEdgePeers, onSelectEdge, refreshTrigger, onCaptureChange }: GeneralPanelProps) {
  const t = useTranslations("viewer");
  const router = useRouter();
  const [nodeStatuses, setNodeStatuses] = useState<LabNodeStatus[]>([]);
  const [labBusy, setLabBusy] = useState(false);
  const [nodeBusy, setNodeBusy] = useState(false);
  const [unloadConfirming, setUnloadConfirming] = useState(false);
  const [wipeConfirming, setWipeConfirming] = useState(false);

  // Edge capture state
  const [encap, setEncap] = useState<string>("ethernet");
  const [linkCaptures, setLinkCaptures] = useState<CaptureInfo[]>([]);
  const [startBusy, setStartBusy] = useState(false);
  const [stoppingIds, setStoppingIds] = useState<Set<number>>(new Set());

  async function refreshNodes() {
    setNodeStatuses(await fetchLabNodes(labId));
  }

  useEffect(() => {
    void refreshNodes();
  }, [labId, refreshTrigger]);

  // When selected edge changes, query active captures on this link
  const selectedEdgeId = selectedEdge?.id;
  useEffect(() => {
    if (!selectedEdgeId) {
      setLinkCaptures([]);
      setEncap("ethernet");
      return;
    }
    void listLabCaptures(labId, selectedEdgeId).then(setLinkCaptures);
  }, [labId, selectedEdgeId]);

  const isLoaded = nodeStatuses.some((n) => n.instance_id !== null);
  const selectedStatus = selectedNode ? (nodeStatuses.find((n) => n.id === selectedNode.id) ?? null) : null;

  async function handleLabAction(fn: () => Promise<{ ok: boolean; errorMessage: string }>, successMsg: string) {
    setLabBusy(true);
    try {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.errorMessage || t("actionFailed"));
      } else {
        toast.success(successMsg);
        await refreshNodes();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setLabBusy(false);
    }
  }

  // Non-blocking variant for slow lab-wide ops (stop/unload can take a while when
  // containers are involved): fire immediately, show an in-progress toast, and let
  // it resolve to success/error without freezing the UI.
  function handleLabActionAsync(
    fn: () => Promise<{ ok: boolean; errorMessage: string }>,
    pendingMsg: string,
    successMsg: string,
  ) {
    setUnloadConfirming(false);
    toast.promise(
      (async () => {
        const result = await fn();
        if (!result.ok) throw new Error(result.errorMessage || t("actionFailed"));
        await refreshNodes();
      })(),
      {
        loading: pendingMsg,
        success: successMsg,
        error: (e) => (e instanceof Error ? e.message : t("actionFailed")),
      },
    );
  }

  async function handleNodeAction(fn: () => Promise<{ ok: boolean; errorMessage: string }>, successMsg: string) {
    setNodeBusy(true);
    try {
      const result = await fn();
      if (result.ok) {
        toast.success(successMsg);
        await refreshNodes();
      } else {
        toast.error(result.errorMessage);
      }
    } finally {
      setNodeBusy(false);
    }
  }

  // Non-blocking variant for a single node's start/stop (can be slow for
  // containers): show an in-progress toast instead of freezing the panel.
  function handleNodeActionAsync(
    fn: () => Promise<{ ok: boolean; errorMessage: string }>,
    pendingMsg: string,
    successMsg: string,
  ) {
    toast.promise(
      (async () => {
        const result = await fn();
        if (!result.ok) throw new Error(result.errorMessage || t("actionFailed"));
        await refreshNodes();
      })(),
      {
        loading: pendingMsg,
        success: successMsg,
        error: (e) => (e instanceof Error ? e.message : t("actionFailed")),
      },
    );
  }

  async function handleStartCapture() {
    if (!selectedEdge) return;
    setStartBusy(true);
    const result = await startLabCapture(labId, selectedEdge.id, encap);
    setStartBusy(false);
    if (result.ok && result.data) {
      setLinkCaptures((prev) => [...prev, result.data!]);
      toast.success(t("captureStarted"));
      onCaptureChange?.();
    } else {
      toast.error(result.errorMessage);
    }
  }

  async function handleStopCapture(captureId: number) {
    setStoppingIds((prev) => new Set(prev).add(captureId));
    const result = await stopLabCapture(labId, captureId);
    setStoppingIds((prev) => { const s = new Set(prev); s.delete(captureId); return s; });
    if (result.ok) {
      setLinkCaptures((prev) => prev.filter((c) => c.captureId !== captureId));
      toast.success(t("captureStopped"));
      onCaptureChange?.();
    } else {
      toast.error(result.errorMessage);
    }
  }

  return (
    <div className="space-y-4">
      {/* Lab controls */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{t("lab.heading")}</p>
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={labBusy}
              onClick={() => void handleLabAction(() => loadLab(labId), t("lab.loaded"))}>
              {t("lab.load")}
            </Button>
            <Button size="sm" variant="outline" disabled={labBusy || !isLoaded}
              onClick={() => setUnloadConfirming(true)}>
              {t("lab.unload")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => router.push(`/topo-editor?id=${labId}`)}>
              {t("lab.edit")}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={labBusy || !isLoaded}
              onClick={() => handleLabActionAsync(() => startAllNodes(labId), t("lab.startingAll"), t("lab.allStarted"))}>
              {t("lab.startAll")}
            </Button>
            <Button size="sm" variant="outline" disabled={labBusy || !isLoaded}
              onClick={() => handleLabActionAsync(() => stopAllNodes(labId), t("lab.stoppingAll"), t("lab.allStopped"))}>
              {t("lab.stopAll")}
            </Button>
            <Button size="sm" variant="outline" disabled={!isLoaded} onClick={() => window.open(`/console?id=${labId}`, `nlc-console-${labId}`)}>
              {t("lab.console")}
            </Button>
          </div>
        </div>
      </div>

      <ConfigsSection labId={labId} isLoaded={isLoaded} />

      {/* Node info + controls */}
      {selectedNode && (
        <div className="space-y-2 rounded border border-border p-3">
          <p className="text-xs font-semibold text-foreground/80">{selectedNode.data.nlc.name}</p>
          <dl className="space-y-1 text-xs">
            <Row label={t("node.profile")} value={selectedNode.data.nlc.profile} />
            <Row label={t("node.image")} value={selectedNode.data.nlc.image} />
            {selectedNode.data.nlc.type === "ioulive86" && (
              <Row label={t("node.interface")} value={String(selectedNode.data.nlc.runtime.interface ?? "—")} />
            )}
            {selectedNode.data.nlc.type === "container" &&
              containerAddresses(selectedNode.data.nlc.runtime.addresses).map((a) => (
                <Row
                  key={a.port}
                  label={`eth${a.port}`}
                  value={`${a.address ?? "—"}${a.prefix != null ? `/${a.prefix}` : ""}${a.gateway ? ` gw ${a.gateway}` : ""}`}
                />
              ))}
            {selectedStatus ? (
              <>
                <Row label={t("node.instanceId")} value={selectedStatus.instance_id ?? "—"} />
                <Row label={t("node.consolePort")} value={selectedStatus.console_port ?? "—"} />
                <Row
                  label={t("node.status")}
                  value={
                    <span className={selectedStatus.status === "running" ? "text-green-600 dark:text-green-500" : "text-muted-foreground/70"}>
                      {t(`node.statusValue.${selectedStatus.status}`)}
                    </span>
                  }
                />
              </>
            ) : (
              <Row label={t("node.status")} value={<span className="text-muted-foreground/70">{t("node.notLoaded")}</span>} />
            )}
          </dl>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button size="sm" className="h-7 text-xs" disabled={!isLoaded}
              onClick={() => handleNodeActionAsync(() => startNode(labId, selectedNode.id), t("node.starting"), t("node.started"))}>
              {t("node.start")}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!isLoaded}
              onClick={() => handleNodeActionAsync(() => stopNode(labId, selectedNode.id), t("node.stopping"), t("node.stopped"))}>
              {t("node.stop")}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={nodeBusy || !isLoaded}
              onClick={() => void handleNodeAction(() => resetNode(labId, selectedNode.id), t("node.consoleReset"))}>
              {t("node.resetConsole")}
            </Button>
            {selectedNode.data.nlc.type === "container" && (
              <Button size="sm" variant="outline" className="h-7 text-xs"
                disabled={nodeBusy || !isLoaded || selectedStatus?.status === "running"}
                title={selectedStatus?.status === "running" ? t("node.stopFirst") : undefined}
                onClick={() => setWipeConfirming(true)}>
                {t("node.wipeData")}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Edge capture */}
      {selectedEdge && !selectedNode && (
        <div className="space-y-3 rounded border border-border p-3">
          <p className="text-xs font-semibold text-foreground/80">{t("capture.heading")}</p>

          {/* Multilink selector */}
          {selectedEdgePeers.length > 1 && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">{t("capture.link")}</p>
              <div className="flex flex-wrap gap-1">
                {selectedEdgePeers.map((p, i) => (
                  <Button
                    key={p.id}
                    size="sm"
                    variant={p.id === selectedEdge.id ? "default" : "outline"}
                    className="h-6 text-xs"
                    onClick={() => onSelectEdge(p.id)}
                  >
                    {t("capture.linkN", { n: i + 1 })}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Start capture */}
          <div className="space-y-2">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">{t("capture.encapsulation")}</p>
              <Select value={encap} onValueChange={setEncap}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DLT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" className="h-7 w-full text-xs" disabled={startBusy || !isLoaded} onClick={() => void handleStartCapture()}>
              {startBusy ? t("capture.starting") : t("capture.start")}
            </Button>
          </div>

          {/* Active captures on this link */}
          {linkCaptures.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t("capture.active")}</p>
              {linkCaptures.map((c) => (
                <div key={c.captureId} className="space-y-1.5 rounded border border-border bg-muted/50 p-2 text-xs">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-muted-foreground">
                      #{c.captureId} · {t("capture.port")} <span className="font-semibold">{parseCapturePort(c.captureUrl)}</span>
                    </span>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        onClick={() => window.open(`/capture?labId=${labId}&captureId=${c.captureId}`, `nlc-capture-${c.captureId}`)}
                      >
                        {t("view")}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-6 px-2 text-xs"
                        disabled={stoppingIds.has(c.captureId)}
                        onClick={() => void handleStopCapture(c.captureId)}
                      >
                        {stoppingIds.has(c.captureId) ? t("stopping") : t("stop")}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!selectedNode && !selectedEdge && <p className="text-center text-xs text-muted-foreground/70">{t("selectHint")}</p>}

      {selectedNode && (
        <ConfirmDialog open={wipeConfirming} onOpenChange={setWipeConfirming} destructive busy={nodeBusy}
          title={t("node.wipeTitle")}
          description={t("node.wipeDescription", { name: selectedNode.data.nlc.name })}
          confirmLabel={t("node.wipeConfirm")}
          onConfirm={() => {
            setWipeConfirming(false);
            void handleNodeAction(() => wipeNode(labId, selectedNode.id), t("node.wiped"));
          }} />
      )}

      <ConfirmDialog open={unloadConfirming} onOpenChange={setUnloadConfirming} destructive busy={labBusy}
        title={t("lab.unloadTitle")}
        description={t("lab.unloadDescription")}
        confirmLabel={t("lab.unload")}
        onConfirm={() => handleLabActionAsync(() => unloadLab(labId), t("lab.unloading"), t("lab.unloaded"))} />
    </div>
  );
}

type ContainerAddress = { port: number; address?: string; prefix?: number; gateway?: string };

/** Configured per-port addresses, in port order (entries with no address are skipped). */
function containerAddresses(v: unknown): ContainerAddress[] {
  if (!Array.isArray(v)) return [];
  return (v as ContainerAddress[]).filter((a) => a && a.address).sort((x, y) => x.port - y.port);
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right text-foreground">{value}</dd>
    </div>
  );
}
