"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PROFILES } from "@/lib/topo/profiles";
import { linkKind } from "@/lib/topo/port-manager";
import { fromLabSpec } from "@/lib/topo/spec";
import {
  pairKey,
  formatInterfaceLabel,
  type CanvasNode,
  type FlowEdge,
  type FlowNode,
  type LabSpecV2,
} from "@/lib/topo/types";
import { DeviceNode } from "@/components/topo/device-node";
import { DeviceEdge } from "@/components/topo/device-edge";
import { AnnotationNode } from "@/components/topo/annotation-node";
import { useAnnotations } from "@/components/topo/use-annotations";
import { TopoModeContext } from "@/components/topo/topo-mode";
import { GeneralPanel } from "./general-panel";
import { CapturesPanel } from "./captures-panel";

const NODE_TYPES = { device: DeviceNode, annotation: AnnotationNode };
const EDGE_TYPES = { device: DeviceEdge };

function nodeUiPattern(node: FlowNode): string {
  return PROFILES[node.data.nlc.profile]?.pattern ?? node.data.ui.pattern;
}

function ifLabel(node: FlowNode | undefined, ep: { slot: number; port: number; uiPrefix?: string } | undefined): string {
  if (!ep) return "";
  if (!node) return `${ep.slot}/${ep.port}`;
  return formatInterfaceLabel({ ...ep, uiPrefix: ep.uiPrefix ?? "" }, nodeUiPattern(node));
}

interface TopoViewerProps {
  spec: LabSpecV2;
}

export function TopoViewer({ spec }: TopoViewerProps) {
  const t = useTranslations("viewer");
  const initial = fromLabSpec(spec, PROFILES);

  const [nodes, , onDeviceNodesChange] = useNodesState<FlowNode>(initial.nodes);
  const [edges] = useEdgesState<FlowEdge>(initial.edges);
  // Display-only here; still stateful so xyflow's measurements are written back.
  const { annotations, onNodesChange } = useAnnotations(
    initial.annotations.map((a) => ({ ...a, selectable: false, focusable: false })),
    onDeviceNodesChange,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showInterface] = useState(true);
  const [refreshTrigger] = useState(0);
  const [captureRefreshTrigger, setCaptureRefreshTrigger] = useState(0);

  const canvasNodes = useMemo((): CanvasNode[] => [...annotations, ...nodes], [annotations, nodes]);

  const onSelectionChange = useCallback((params: OnSelectionChangeParams<CanvasNode, FlowEdge>) => {
    const device = params.nodes.find((n) => n.type === "device");
    setSelectedNodeId(device?.id ?? null);
    if (device) setSelectedEdgeId(null);
  }, []);

  const onEdgeClick = useCallback((_e: React.MouseEvent, edge: FlowEdge) => {
    setSelectedNodeId(null);
    setSelectedEdgeId(edge.id);
  }, []);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find((e) => e.id === selectedEdgeId) ?? null, [edges, selectedEdgeId]);
  const selectedEdgePeers = useMemo(() => {
    if (!selectedEdge) return [];
    const key = pairKey(selectedEdge.source, selectedEdge.target);
    return edges.filter((e) => pairKey(e.source, e.target) === key);
  }, [edges, selectedEdge]);

  const renderedEdges = useMemo((): FlowEdge[] => {
    const groups = new Map<string, FlowEdge[]>();
    for (const e of edges) {
      const key = pairKey(e.source, e.target);
      const bucket = groups.get(key);
      if (bucket) bucket.push(e);
      else groups.set(key, [e]);
    }

    const result: FlowEdge[] = [];
    for (const group of groups.values()) {
      const active = group.find((e) => e.id === selectedEdgeId) ?? group[0];
      const selectedInGroup = selectedEdgeId !== null && group.some((e) => e.id === selectedEdgeId);
      const srcNode = nodes.find((n) => n.id === active.source);
      const tgtNode = nodes.find((n) => n.id === active.target);
      const [ep0, ep1] = active.data?.nlc?.endpoints ?? [];
      const collapsedLabel = group.length > 1 && !selectedInGroup ? t("multilink") : null;
      if (!active.data) continue;
      result.push({
        ...active,
        selected: selectedInGroup,
        data: {
          ...active.data,
          ui: {
            bundleCount: group.length,
            showInterface,
            veth: linkKind(srcNode?.data.nlc.type, tgtNode?.data.nlc.type) === "veth",
            sourceIfName: collapsedLabel ?? ifLabel(srcNode, ep0),
            targetIfName: collapsedLabel ?? ifLabel(tgtNode, ep1),
          },
        },
      });
    }
    return result;
  }, [edges, nodes, selectedEdgeId, showInterface, t]);

  return (
    <TopoModeContext.Provider value={{ readonly: true }}>
      <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-background">
        {/* Top bar */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-2">
          <p className="text-sm font-semibold text-foreground">{spec.lab.name}</p>
          {spec.lab.description && <p className="max-w-xs truncate text-sm text-muted-foreground" title={spec.lab.description}>{spec.lab.description}</p>}
          <span className="font-mono text-xs text-muted-foreground/70 ml-auto">{spec.lab.id}</span>
        </div>

        {/* Main area */}
        <div className="flex min-h-0 flex-1">
          {/* Left sidebar */}
          <aside className="w-72 shrink-0 overflow-y-auto border-r border-border bg-card">
            <Tabs defaultValue="general" className="p-3">
              <TabsList className="w-full">
                <TabsTrigger value="general">{t("tabs.general")}</TabsTrigger>
                <TabsTrigger value="captures">{t("tabs.captures")}</TabsTrigger>
              </TabsList>

              <TabsContent value="general">
                <GeneralPanel
                  labId={spec.lab.id}
                  selectedNode={selectedNode}
                  selectedEdge={selectedEdge}
                  selectedEdgePeers={selectedEdgePeers}
                  onSelectEdge={setSelectedEdgeId}
                  refreshTrigger={refreshTrigger}
                  onCaptureChange={() => setCaptureRefreshTrigger(t => t + 1)}
                />
              </TabsContent>

              <TabsContent value="captures">
                <CapturesPanel labId={spec.lab.id} refreshTrigger={captureRefreshTrigger} />
              </TabsContent>
            </Tabs>
          </aside>

          {/* Canvas */}
          <div className="relative min-h-0 flex-1">
            <ReactFlow
              nodes={canvasNodes}
              edges={renderedEdges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onNodesChange={onNodesChange}
              onSelectionChange={onSelectionChange}
              onEdgeClick={onEdgeClick}
              nodesDraggable={false}
              nodesConnectable={false}
              fitView
            >
              <Background />
              <Controls />
            </ReactFlow>
          </div>
        </div>
      </div>
    </TopoModeContext.Provider>
  );
}
