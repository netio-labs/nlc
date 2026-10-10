"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Connection,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import { ArrowUpRightIcon, CircleIcon, LineSegmentIcon, SquareIcon, TextTIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PortManager, linkKind, portRefKey, type PortRef } from "@/lib/topo/port-manager";
import { PROFILES, inferNodeNamePrefix, runtimeFieldsFor, withIoulive86Bind } from "@/lib/topo/profiles";
import { fromLabSpec, toAnnotationNode, toLabSpec } from "@/lib/topo/spec";
import {
  createId,
  pairKey,
  applyEdgeType,
  formatInterfaceLabel,
  findSnapPosition,
  DEFAULT_ANNOTATION_FONT_SIZE,
  type AnnotationData,
  type AnnotationKind,
  type AnnotationNode as AnnotationNodeType,
  type LineKind,
  type Point,
  isLineKind,
  type CanvasNode,
  type FlowEdge,
  type FlowEdgeData,
  type FlowEdgeEndpoint,
  type FlowNode,
  type FlowNodeData,
  type InterfaceFamily,
  type LabSpecV2,
} from "@/lib/topo/types";
import { fetchContainerImages, fetchImagesByProfile } from "@/actions/images";
import { fetchHostInterfaces, type HostInterface } from "@/actions/host";
import { applyCatalogEntry, catalogIdFor, loadCatalogEntry, type ContainerImage } from "@/lib/topo/container-catalog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveLab, updateLab } from "@/actions";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { DeviceNode } from "@/components/topo/device-node";
import { DeviceEdge } from "@/components/topo/device-edge";
import { AnnotationNode } from "@/components/topo/annotation-node";
import { AnnotationDrawLayer } from "@/components/topo/annotation-draw-layer";
import { useAnnotations } from "@/components/topo/use-annotations";
import { TopoModeContext } from "@/components/topo/topo-mode";
import { NodePanel } from "./node-panel";
import { EdgePanel, type EdgeEndpointDesc, type PortOption } from "./edge-panel";
import { AnnotationPanel } from "./annotation-panel";

// ─── Static config ───────────────────────────────────────────────────────────

const NODE_TYPES = { device: DeviceNode, annotation: AnnotationNode };
const EDGE_TYPES = { device: DeviceEdge };
const SNAP_THRESHOLD = 12;
const NEW_SHAPE_SIZE = { width: 240, height: 160 };
// Tooltips are editor.tools.<kind>.
const ANNOTATION_TOOLS: { kind: AnnotationKind; Icon: typeof SquareIcon }[] = [
  { kind: "rect", Icon: SquareIcon },
  { kind: "ellipse", Icon: CircleIcon },
  { kind: "text", Icon: TextTIcon },
  { kind: "line", Icon: LineSegmentIcon },
  { kind: "arrow", Icon: ArrowUpRightIcon },
];

type ProfileKey = Parameters<ReturnType<typeof useTranslations<"editor">>>[0];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readNodeFamilies(node: FlowNode | null): InterfaceFamily[] {
  if (!node) return [];
  const seen = new Set<InterfaceFamily>();
  const out: InterfaceFamily[] = [];
  for (const iface of node.data.nlc.interfaces) {
    if ((iface.family === "ethernet" || iface.family === "serial") && !seen.has(iface.family)) {
      seen.add(iface.family);
      out.push(iface.family);
    }
  }
  return out;
}

function intersectFamilies(a: InterfaceFamily[], b: InterfaceFamily[]): InterfaceFamily[] {
  const bSet = new Set(b);
  return a.filter((f) => bSet.has(f));
}

function nextNodeName(nodes: FlowNode[], prefix: string): string {
  const re = new RegExp(`^${prefix}(\\d+)$`, "i");
  let max = 0;
  for (const n of nodes) {
    const m = (n.data.nlc.name ?? "").match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${max + 1}`;
}

function nodeUiPattern(node: FlowNode): string {
  return PROFILES[node.data.nlc.profile]?.pattern ?? node.data.ui.pattern;
}

// Interface label for an edge endpoint, following the node's profile pattern.
function ifLabel(node: FlowNode | undefined, ep: FlowEdgeEndpoint | undefined): string {
  if (!ep) return "";
  if (!node) return `${ep.slot}/${ep.port}`;
  return formatInterfaceLabel(ep, nodeUiPattern(node));
}

function toEndpointFromRef(ref: PortRef): FlowEdgeEndpoint {
  return { family: ref.family, slot: ref.slot, port: ref.port, uiPrefix: ref.uiPrefix };
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TopoEditor({ initialSpec, isExisting: initialIsExisting = false }: { initialSpec?: LabSpecV2; isExisting?: boolean }) {
  const router = useRouter();
  const t = useTranslations("editor");
  const initial = initialSpec ? fromLabSpec(initialSpec, PROFILES) : null;

  const [isExisting, setIsExisting] = useState(initialIsExisting);
  const [lab, setLab] = useState(initial?.lab ?? { id: createId(), name: "New Lab", description: "" });
  const [viewport, setViewport] = useState<Viewport>(initial?.viewport ?? { x: 0, y: 0, zoom: 1 });
  const [nodes, setNodes, onDeviceNodesChange] = useNodesState<FlowNode>(initial?.nodes ?? []);
  const [edges, setEdges] = useEdgesState<FlowEdge>(initial?.edges ?? []);
  const { annotations, setAnnotations, onNodesChange } = useAnnotations(initial?.annotations ?? [], onDeviceNodesChange);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [drawTool, setDrawTool] = useState<LineKind | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance<CanvasNode, FlowEdge> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showInterface, setShowInterface] = useState(true);
  const [imagesByProfile, setImagesByProfile] = useState<Record<string, string[]>>({});
  const [hostInterfaces, setHostInterfaces] = useState<HostInterface[]>([]);
  const [containerImages, setContainerImages] = useState<{ images: ContainerImage[]; errorMessage: string }>({ images: [], errorMessage: "" });
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");

  // Lazy-initialize portManager so it starts with any pre-loaded nodes/edges
  const portManager = useRef<PortManager | null>(null);
  if (!portManager.current) {
    portManager.current = new PortManager();
    portManager.current.reset(initial?.nodes ?? [], initial?.edges ?? []);
  }

  const nodesRef = useRef<FlowNode[]>(initial?.nodes ?? []);
  const edgesRef = useRef<FlowEdge[]>(initial?.edges ?? []);

  // Keep refs in sync so callbacks always see current state without stale closures
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  // Fetch images for all known profiles and host interfaces (ioulive86) on mount
  useEffect(() => {
    async function loadOptions() {
      try {
        const [images, interfaces, ctrImages] = await Promise.all([
          fetchImagesByProfile(),
          fetchHostInterfaces(),
          fetchContainerImages(),
        ]);
        setImagesByProfile({ ...images, container: ctrImages.images.map((i) => i.ref) });
        setContainerImages(ctrImages);
        setHostInterfaces(interfaces);
      } catch {}
    }
    void loadOptions();
  }, []);

  // ─── Connect (create edge) ─────────────────────────────────────────────────

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      const srcNode = currentNodes.find((n) => n.id === connection.source);
      const tgtNode = currentNodes.find((n) => n.id === connection.target);
      if (!srcNode || !tgtNode) return;

      // Container links (veth): a container connects only to another container or to
      // an IOULive86 bridge. A bridge in physical-NIC mode is switched to "auto" first,
      // which gives it the container-side port (e0/1). Port accounting is the PortManager's.
      const kind = linkKind(srcNode.data.nlc.type, tgtNode.data.nlc.type);
      const peer = srcNode.data.nlc.type === "container" ? tgtNode : srcNode;
      let nextNodes = currentNodes;
      if (kind === "veth") {
        const peerType = peer.data.nlc.type;
        if (peerType !== "container" && peerType !== "ioulive86") {
          toast.error(t("toast.vethPeer"));
          return;
        }
        if (peerType === "ioulive86" && peer.data.nlc.runtime.interface !== "auto") {
          nextNodes = currentNodes.map((n) => (n.id === peer.id ? { ...n, data: withIoulive86Bind(n.data, "auto") } : n));
        }
      }

      const familyPriority = intersectFamilies(readNodeFamilies(srcNode), readNodeFamilies(tgtNode));
      if (familyPriority.length === 0) {
        toast.error(t("toast.noCommonFamily"));
        return;
      }

      const pm = portManager.current!;
      const resetErr = pm.reset(nextNodes, currentEdges);
      if (resetErr) {
        toast.error(resetErr);
        return;
      }

      const edgeId = createId();
      const allocation = pm.allocateFirstAvailablePair(edgeId, srcNode.id, tgtNode.id, familyPriority);
      if (!allocation) {
        if (nextNodes !== currentNodes) pm.reset(currentNodes, currentEdges); // undo the auto switch
        toast.error(kind === "veth" && peer.data.nlc.type === "ioulive86"
          ? t("toast.bridgeTaken")
          : t("toast.noLinkInterfaces"));
        return;
      }
      if (nextNodes !== currentNodes) setNodes(nextNodes);

      const newEdge: FlowEdge = {
        id: edgeId,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? "s-right",
        targetHandle: connection.targetHandle ?? "t-left",
        type: "device",
        data: {
          nlc: {
            endpoints: [toEndpointFromRef(allocation.sourceRef), toEndpointFromRef(allocation.targetRef)],
            description: "",
          },
          ui: kind === "veth" ? { veth: true } : {},
        },
      };
      setEdges(applyEdgeType([...currentEdges, newEdge]));
    },
    [setEdges, setNodes, t],
  );

  // ─── Selection ────────────────────────────────────────────────────────────

  const onSelectionChange = useCallback((params: OnSelectionChangeParams<CanvasNode, FlowEdge>) => {
    const device = params.nodes.find((n) => n.type === "device");
    const annotation = params.nodes.find((n) => n.type === "annotation");
    setSelectedNodeId(device?.id ?? null);
    setSelectedAnnotationId(device ? null : (annotation?.id ?? null));
    if (params.nodes.length > 0) setSelectedEdgeId(null);
  }, []);

  const onEdgeClick = useCallback((_e: React.MouseEvent, edge: FlowEdge) => {
    setSelectedNodeId(null);
    setSelectedAnnotationId(null);
    setSelectedEdgeId(edge.id);
  }, []);


  // ─── Delete callbacks ─────────────────────────────────────────────────────

  const onEdgesDelete = useCallback(
    (deleted: FlowEdge[]) => {
      const ids = new Set(deleted.map((e) => e.id));
      setEdges((cur) => applyEdgeType(cur.filter((e) => !ids.has(e.id))));
      for (const e of deleted) portManager.current!.releaseEdge(e.id);
      if (selectedEdgeId && ids.has(selectedEdgeId)) setSelectedEdgeId(null);
    },
    [selectedEdgeId, setEdges],
  );

  const onNodesDelete = useCallback(
    (deleted: CanvasNode[]) => {
      const removedEdges = new Set<string>();
      for (const n of deleted) {
        if (n.type !== "device") continue;
        for (const id of portManager.current!.unregisterNode(n.id)) removedEdges.add(id);
      }
      if (selectedNodeId && deleted.some((n) => n.id === selectedNodeId)) setSelectedNodeId(null);
      if (selectedAnnotationId && deleted.some((n) => n.id === selectedAnnotationId)) setSelectedAnnotationId(null);
      if (selectedEdgeId && removedEdges.has(selectedEdgeId)) setSelectedEdgeId(null);
    },
    [selectedAnnotationId, selectedEdgeId, selectedNodeId],
  );

  // ─── Node drag with alignment snap ────────────────────────────────────────

  const onNodeDrag = useCallback(
    (_e: React.MouseEvent, dragging: CanvasNode) => {
      if (dragging.type !== "device") return;
      const { x: snapX, y: snapY } = findSnapPosition(dragging, nodesRef.current, SNAP_THRESHOLD);
      if (snapX === null && snapY === null) return;
      setNodes((cur) =>
        cur.map((n) => {
          if (n.id !== dragging.id) return n;
          return { ...n, position: { x: snapX ?? n.position.x, y: snapY ?? n.position.y } };
        }),
      );
    },
    [setNodes],
  );

  const onNodeDragStop = useCallback(
    (_e: React.MouseEvent, dragging: CanvasNode) => {
      if (dragging.type !== "device") return;
      const { x: snapX, y: snapY } = findSnapPosition(dragging, nodesRef.current, SNAP_THRESHOLD);
      if (snapX !== null || snapY !== null) {
        setNodes((cur) =>
          cur.map((n) => (n.id !== dragging.id ? n : { ...n, position: { x: snapX ?? n.position.x, y: snapY ?? n.position.y } })),
        );
      }
    },
    [setNodes],
  );

  // ─── Container image → catalog parameters ─────────────────────────────────

  // Copy the image's catalog entry (command / run options / shell) into the node,
  // unless its image changed again while the entry was loading. A failed load
  // leaves the node as is; the node panel shows the error.
  const applyContainerImage = useCallback(
    async (nodeId: string, image: string) => {
      const { entry } = await loadCatalogEntry(catalogIdFor(image, containerImages.images));
      if (!entry) return;
      setNodes((cur) => cur.map((n) => (n.id === nodeId && n.data.nlc.image === image
        ? { ...n, data: { ...n.data, nlc: { ...n.data.nlc, runtime: applyCatalogEntry(n.data.nlc.runtime, entry) } } }
        : n)));
    },
    [containerImages, setNodes],
  );

  // ─── Add device ────────────────────────────────────────────────────────────

  const addDevice = useCallback(
    (profileId: string) => {
      const profile = PROFILES[profileId];
      if (!profile) return;
      const id = createId();
      const image = profile.fixedImage ?? imagesByProfile[profileId]?.[0] ?? "";
      setNodes((cur) => {
        const name = nextNodeName(cur, inferNodeNamePrefix(profileId));
        const node: FlowNode = {
          id,
          type: "device",
          position: { x: 220 + cur.length * 40, y: 240 + cur.length * 20 },
          data: {
            nlc: {
              type: profile.type,
              profile: profileId,
              vendor: profile.vendor,
              name,
              image,
              interfaces: profile.defaultInterfaces.map((i) => ({ ...i })),
              runtime: Object.fromEntries(
                Object.entries(runtimeFieldsFor(profile, image)).map(([k, v]) => [
                  k,
                  v.type === "select" && !v.default ? (hostInterfaces[0]?.name ?? "") : v.default,
                ]),
              ),
            },
            ui: { icon: profile.icon, pattern: profile.pattern },
          },
        };
        const err = portManager.current!.registerNode(node);
        if (err) console.warn("PortManager registerNode:", err);
        return [...cur, node];
      });
      if (profile.type === "container") void applyContainerImage(id, image);
    },
    [imagesByProfile, hostInterfaces, setNodes, applyContainerImage],
  );

  // ─── Annotations ──────────────────────────────────────────────────────────

  // A newly created annotation becomes the only selected node.
  const insertSelected = useCallback(
    (node: AnnotationNodeType) => {
      setNodes((cur) => cur.map((n) => (n.selected ? { ...n, selected: false } : n)));
      setAnnotations((cur) => [...cur.map((a) => (a.selected ? { ...a, selected: false } : a)), { ...node, selected: true }]);
    },
    [setAnnotations, setNodes],
  );

  // Box/ellipse/text land in the middle of the visible canvas.
  const addAnnotation = useCallback(
    (kind: AnnotationKind) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const center =
        rfInstance && rect
          ? rfInstance.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
          : { x: 200, y: 200 };
      const isText = kind === "text";
      const node = toAnnotationNode({
        id: createId(),
        kind,
        x: center.x - (isText ? 20 : NEW_SHAPE_SIZE.width / 2),
        y: center.y - (isText ? 10 : NEW_SHAPE_SIZE.height / 2),
        ...(isText ? { text: "Text" } : NEW_SHAPE_SIZE),
        color: "gray",
        fontSize: DEFAULT_ANNOTATION_FONT_SIZE,
      });
      insertSelected(node);
    },
    [insertSelected, rfInstance],
  );

  // Line/arrow are drawn with the mouse; see AnnotationDrawLayer.
  const onDrawAnnotation = useCallback(
    (kind: LineKind, flowPoints: Point[]) => {
      insertSelected(toAnnotationNode({ id: createId(), kind, x: 0, y: 0, points: flowPoints, color: "gray" }));
      setDrawTool(null);
    },
    [insertSelected],
  );
  const cancelDraw = useCallback(() => setDrawTool(null), []);

  const updateSelectedAnnotation = useCallback(
    (patch: Partial<AnnotationData>) => {
      if (!selectedAnnotationId) return;
      setAnnotations((cur) => cur.map((a) => (a.id === selectedAnnotationId ? { ...a, data: { ...a.data, ...patch } } : a)));
    },
    [selectedAnnotationId, setAnnotations],
  );

  const deleteSelectedAnnotation = useCallback(() => {
    setAnnotations((cur) => cur.filter((a) => a.id !== selectedAnnotationId));
    setSelectedAnnotationId(null);
  }, [selectedAnnotationId, setAnnotations]);

  // ─── Update selected node ─────────────────────────────────────────────────

  const updateSelectedNode = useCallback(
    (mutator: (data: FlowNodeData) => FlowNodeData) => {
      if (!selectedNodeId) return;
      let updated: FlowNode | null = null;
      const nextNodes = nodesRef.current.map((n) => {
        if (n.id !== selectedNodeId) return n;
        updated = { ...n, data: mutator(n.data) };
        return updated;
      });
      if (!updated) return;
      const { invalidEdgeIds, error } = portManager.current!.updateNode(updated);
      if (error) console.warn("PortManager updateNode:", error);
      setNodes(nextNodes);

      // Port count changes (a container shrinking, a bridge leaving "auto" and losing
      // e0/1) invalidate the links on ports that no longer exist.
      const remove = new Set(invalidEdgeIds);
      if (remove.size > 0) {
        setEdges((cur) => applyEdgeType(cur.filter((e) => !remove.has(e.id))));
        if (selectedEdgeId && remove.has(selectedEdgeId)) setSelectedEdgeId(null);
      }
    },
    [selectedEdgeId, selectedNodeId, setEdges, setNodes],
  );

  // ─── Update selected edge ─────────────────────────────────────────────────

  const updateSelectedEdge = useCallback(
    (mutator: (data: FlowEdgeData) => FlowEdgeData) => {
      if (!selectedEdgeId) return;
      setEdges((cur) => cur.map((e) => (e.id === selectedEdgeId && e.data ? { ...e, data: mutator(e.data) } : e)));
    },
    [selectedEdgeId, setEdges],
  );

  // ─── Edge family / port change ────────────────────────────────────────────

  const onFamilyChange = useCallback(
    (nextFamily: InterfaceFamily) => {
      const edge = edgesRef.current.find((e) => e.id === selectedEdgeId);
      if (!edge) return;
      const allocation = portManager.current!.retypeEdge(edge.id, nextFamily);
      if (!allocation) {
        toast.error(t("toast.noFamilyInterfaces"));
        return;
      }
      updateSelectedEdge((data) => ({
        ...data,
        nlc: {
          ...data.nlc,
          endpoints: [
            toEndpointFromRef({ ...allocation.sourceRef, family: nextFamily }),
            toEndpointFromRef({ ...allocation.targetRef, family: nextFamily }),
          ],
        },
      }));
    },
    [selectedEdgeId, t, updateSelectedEdge],
  );

  // ─── Derived: selected items ──────────────────────────────────────────────

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const selectedAnnotation = useMemo(
    () => annotations.find((a) => a.id === selectedAnnotationId) ?? null,
    [annotations, selectedAnnotationId],
  );
  const canvasNodes = useMemo((): CanvasNode[] => [...annotations, ...nodes], [annotations, nodes]);
  const selectedEdge = useMemo(() => edges.find((e) => e.id === selectedEdgeId) ?? null, [edges, selectedEdgeId]);
  const selectedEdgeSrcNode = useMemo(() => nodes.find((n) => n.id === selectedEdge?.source) ?? null, [nodes, selectedEdge?.source]);
  const selectedEdgeTgtNode = useMemo(() => nodes.find((n) => n.id === selectedEdge?.target) ?? null, [nodes, selectedEdge?.target]);

  const selectedEdgePeers = useMemo(() => {
    if (!selectedEdge) return [];
    const key = pairKey(selectedEdge.source, selectedEdge.target);
    return edges.filter((e) => pairKey(e.source, e.target) === key);
  }, [edges, selectedEdge]);

  const selectedEdgeFamilyOptions = useMemo((): InterfaceFamily[] => {
    return intersectFamilies(readNodeFamilies(selectedEdgeSrcNode), readNodeFamilies(selectedEdgeTgtNode));
  }, [selectedEdgeSrcNode, selectedEdgeTgtNode]);

  const selectedEdgeFamily = useMemo((): InterfaceFamily => {
    const f = selectedEdge?.data?.nlc?.endpoints?.[0]?.family;
    if (f === "ethernet" || f === "serial") return f;
    return selectedEdgeFamilyOptions[0] ?? "ethernet";
  }, [selectedEdge, selectedEdgeFamilyOptions]);

  const autoDescription = useMemo(() => {
    if (!selectedEdge) return "";
    const [ep0, ep1] = selectedEdge.data?.nlc?.endpoints ?? [];
    const sn = selectedEdgeSrcNode?.data.nlc.name ?? "?";
    const tn = selectedEdgeTgtNode?.data.nlc.name ?? "?";
    return ep0 && ep1 ? `${sn} (${ep0.slot}/${ep0.port}) <-> ${tn} (${ep1.slot}/${ep1.port})` : "";
  }, [selectedEdge, selectedEdgeSrcNode, selectedEdgeTgtNode]);

  function buildPortOptions(node: FlowNode | null, family: InterfaceFamily, edgeId: string): PortOption[] {
    if (!node) return [];
    const pattern = nodeUiPattern(node);
    return portManager
      .current!.getAvailablePorts(node.id, family, edgeId)
      .map((ref) => ({ value: portRefKey(ref), label: formatInterfaceLabel(ref, pattern) }));
  }

  function currentInterfaceValue(ep: FlowEdgeEndpoint | undefined, family: InterfaceFamily): string {
    if (!ep) return "";
    return portRefKey({ family, slot: ep.slot, port: ep.port });
  }

  const edgeEndpoints = useMemo((): EdgeEndpointDesc[] => {
    if (!selectedEdge) return [];
    const edge = selectedEdge;

    const ep0 = edge.data?.nlc?.endpoints?.[0];
    const ep1 = edge.data?.nlc?.endpoints?.[1];

    function makeInterfaceOptions(node: FlowNode | null, currentEp: FlowEdgeEndpoint | undefined): PortOption[] {
      const available = buildPortOptions(node, selectedEdgeFamily, edge.id);
      const current = currentEp
        ? {
            value: currentInterfaceValue(currentEp, selectedEdgeFamily),
            label: node ? formatInterfaceLabel(currentEp, nodeUiPattern(node)) : `${currentEp.slot}/${currentEp.port}`,
          }
        : null;
      if (current && !available.some((o) => o.value === current.value)) return [current, ...available];
      return available;
    }

    return [
      {
        id: "source",
        node: selectedEdgeSrcNode,
        handle: edge.sourceHandle ?? "s-right",
        interfaceValue: currentInterfaceValue(ep0, selectedEdgeFamily),
        interfaceOptions: makeInterfaceOptions(selectedEdgeSrcNode, ep0),
        onHandleChange: (v) => setEdges((cur) => cur.map((e) => (e.id === edge.id ? { ...e, sourceHandle: v } : e))),
        onInterfaceChange: (v) => {
          const ref = portManager
            .current!.getAvailablePorts(selectedEdgeSrcNode!.id, selectedEdgeFamily, edge.id)
            .find((r) => portRefKey(r) === v);
          if (!ref || !portManager.current!.updateEdgePort(edge.id, "source", ref)) {
            toast.error(t("toast.interfaceUnavailable"));
            return;
          }
          updateSelectedEdge((data) => ({ ...data, nlc: { ...data.nlc, endpoints: [toEndpointFromRef(ref), data.nlc.endpoints[1]] } }));
        },
      },
      {
        id: "target",
        node: selectedEdgeTgtNode,
        handle: edge.targetHandle ?? "t-left",
        interfaceValue: currentInterfaceValue(ep1, selectedEdgeFamily),
        interfaceOptions: makeInterfaceOptions(selectedEdgeTgtNode, ep1),
        onHandleChange: (v) => setEdges((cur) => cur.map((e) => (e.id === edge.id ? { ...e, targetHandle: v } : e))),
        onInterfaceChange: (v) => {
          const ref = portManager
            .current!.getAvailablePorts(selectedEdgeTgtNode!.id, selectedEdgeFamily, edge.id)
            .find((r) => portRefKey(r) === v);
          if (!ref || !portManager.current!.updateEdgePort(edge.id, "target", ref)) {
            toast.error(t("toast.interfaceUnavailable"));
            return;
          }
          updateSelectedEdge((data) => ({ ...data, nlc: { ...data.nlc, endpoints: [data.nlc.endpoints[0], toEndpointFromRef(ref)] } }));
        },
      },
    ];
  }, [selectedEdge, selectedEdgeFamily, selectedEdgeSrcNode, selectedEdgeTgtNode, setEdges, t, updateSelectedEdge]);

  // ─── Rendered edges (multilink-aware) ────────────────────────────────────

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

  // ─── Save ─────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    try {
      const spec = toLabSpec({ lab, nodes, edges, annotations, viewport });
      const result = await (isExisting ? updateLab(spec) : saveLab(spec));
      if (!result.ok) throw new Error(result.errorMessage);
      toast.success(t("toast.saved"));
      // 如果是新建lab，保存后跳转到编辑页并设置为已存在状态；如果是已存在lab，保持在当前页不跳转
      if (!isExisting) {
        setIsExisting(true);
        router.replace(`/topo-editor?id=${spec.lab.id}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.saveFailed"));
    } finally {
      setSaveStatus("idle");
    }
  }, [annotations, edges, lab, nodes, viewport, t]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <TopoModeContext.Provider value={{ readonly: false }}>
      <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-background">
        {/* Top bar */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-2">
          <Input
            className="w-48"
            value={lab.name}
            onChange={(e) => setLab((l) => ({ ...l, name: e.target.value }))}
            placeholder={t("topBar.labName")}
          />
          <Input
            className="flex-1"
            value={lab.description}
            onChange={(e) => setLab((l) => ({ ...l, description: e.target.value }))}
            placeholder={t("topBar.description")}
          />
          {isExisting && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/topo-viewer?id=${lab.id}`}>{t("topBar.view")}</Link>
            </Button>
          )}
          <Button size="sm" onClick={() => void handleSave()} disabled={saveStatus === "saving"}>
            {saveStatus === "saving" ? t("topBar.saving") : t("topBar.save")}
          </Button>
        </div>

        {/* Main area */}
        <div className="flex min-h-0 flex-1">
          {/* Left sidebar */}
          <aside className="w-72 shrink-0 overflow-y-auto border-r border-border bg-card">
            <Tabs defaultValue="build" className="p-3">
              <TabsList className="w-full">
                <TabsTrigger value="build">{t("sidebar.build")}</TabsTrigger>
                <TabsTrigger value="settings">{t("sidebar.labSettings")}</TabsTrigger>
              </TabsList>

              <TabsContent value="build">
                {selectedNode ? (
                  <NodePanel node={selectedNode} imagesByProfile={imagesByProfile} hostInterfaces={hostInterfaces}
                             containerImages={containerImages} applyContainerImage={applyContainerImage} updateNode={updateSelectedNode} />
                ) : selectedAnnotation ? (
                  <AnnotationPanel annotation={selectedAnnotation} update={updateSelectedAnnotation} onDelete={deleteSelectedAnnotation} />
                ) : selectedEdge ? (
                  <EdgePanel
                    edge={selectedEdge}
                    peers={selectedEdgePeers}
                    family={selectedEdgeFamily}
                    familyOptions={selectedEdgeFamilyOptions}
                    endpoints={edgeEndpoints}
                    autoDescription={autoDescription}
                    setSelectedEdgeId={setSelectedEdgeId}
                    updateEdge={updateSelectedEdge}
                    onFamilyChange={onFamilyChange}
                  />
                ) : (
                  <p className="mt-4 text-center text-xs text-muted-foreground/70">{t("sidebar.emptySelection")}</p>
                )}
              </TabsContent>

              <TabsContent value="settings">
                <div className="space-y-4">
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{t("sidebar.showInterfaceLabels")}</p>
                    <Button size="sm" variant={showInterface ? "default" : "outline"} onClick={() => setShowInterface((v) => !v)}>
                      {showInterface ? t("sidebar.on") : t("sidebar.off")}
                    </Button>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{t("sidebar.labId")}</p>
                    <p className="font-mono text-xs text-muted-foreground/70 break-all">{lab.id}</p>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </aside>

          {/* Canvas */}
          <div ref={canvasRef} className="relative min-h-0 flex-1">
            <ReactFlow
              nodes={canvasNodes}
              edges={renderedEdges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onInit={setRfInstance}
              onNodesChange={onNodesChange}
              onConnect={onConnect}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onSelectionChange={onSelectionChange}
              onEdgeClick={onEdgeClick}
              onEdgesDelete={onEdgesDelete}
              onNodesDelete={onNodesDelete}
              onMoveEnd={(_, vp) => setViewport(vp)}
              fitView
              deleteKeyCode="Delete"
            >
              <Background />
              <Controls />
            </ReactFlow>

            {drawTool && rfInstance && (
              <AnnotationDrawLayer
                tool={drawTool}
                screenToFlowPosition={rfInstance.screenToFlowPosition}
                onDraw={onDrawAnnotation}
                onCancel={cancelDraw}
              />
            )}

            {/* Add device toolbar */}
            <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md border bg-popover px-1.5 py-1.5 shadow-lg">
              {Object.entries(PROFILES).map(([id, profile]) => (
                <button
                  key={id}
                  title={t(`profiles.${id}` as ProfileKey)}
                  onClick={() => addDevice(id)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-accent cursor-pointer"
                >
                  <img src={`/icons/${profile.icon}`} alt={t(`profiles.${id}` as ProfileKey)} className="h-6 w-6" draggable={false} />
                </button>
              ))}
              <div className="mx-0.5 h-6 w-px bg-border" />
              {ANNOTATION_TOOLS.map(({ kind, Icon }) => (
                <button
                  key={kind}
                  title={t(`tools.${kind}`)}
                  aria-pressed={drawTool === kind}
                  onClick={() => {
                    if (isLineKind(kind)) {
                      setDrawTool((cur) => (cur === kind ? null : kind));
                    } else {
                      setDrawTool(null);
                      addAnnotation(kind);
                    }
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground cursor-pointer"
                >
                  <Icon className="size-5" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </TopoModeContext.Provider>
  );
}
