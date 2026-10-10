import { lineNodeGeometry } from "./annotation-geometry";
import type { ProfileDef } from "./profiles";
import { linkKind } from "./port-manager";
import {
  DEFAULT_ANNOTATION_FONT_SIZE,
  DEFAULT_STROKE_WIDTH,
  isBoxKind,
  isLineKind,
  type AnnotationNode,
  type FlowEdge,
  type FlowNode,
  type LabSpecAnnotation,
  type LabSpecLink,
  type LabSpecNode,
  type LabSpecUi,
  type LabSpecV2,
  type NlcInterface,
  type NodeType,
} from "./types";

// ─── Annotations ────────────────────────────────────────────────────────────
// Boxes/ellipses sit below edges and devices; text and lines float above them
// (lines only catch the pointer on the stroke itself, so they never block devices).
const SHAPE_Z = -1;
const TOP_Z = 10;
// Box/ellipse/line wrappers ignore the pointer so only their stroke (plus label and
// handles) is interactive. Must be node.style: xyflow writes an inline
// pointer-events on the wrapper that CSS can't override.
const CLICK_THROUGH = { pointerEvents: "none" as const };

export function toAnnotationNode(a: LabSpecAnnotation): AnnotationNode {
  const data = {
    kind: a.kind,
    text: a.text ?? "",
    color: a.color ?? "gray",
    fontSize: a.fontSize ?? DEFAULT_ANNOTATION_FONT_SIZE,
    strokeWidth: a.strokeWidth ?? DEFAULT_STROKE_WIDTH,
    rotation: a.rotation ?? 0,
    labelPosition: a.labelPosition ?? (a.kind === "ellipse" ? ("top" as const) : ("top-left" as const)),
  };
  const base = { id: a.id, type: "annotation" as const };

  if (isLineKind(a.kind)) {
    const { position, width, height, points } = lineNodeGeometry((a.points ?? []).map((p) => ({ x: a.x + p.x, y: a.y + p.y })));
    return { ...base, position, width, height, zIndex: TOP_Z, style: CLICK_THROUGH, data: { ...data, points } };
  }
  if (a.kind === "text") {
    return { ...base, position: { x: a.x, y: a.y }, zIndex: TOP_Z, data };
  }
  return { ...base, position: { x: a.x, y: a.y }, width: a.width ?? 240, height: a.height ?? 160, zIndex: SHAPE_Z, style: CLICK_THROUGH, data };
}

function fromAnnotationNode(n: AnnotationNode): LabSpecAnnotation {
  const { kind, text, color, fontSize, strokeWidth, rotation, labelPosition, points } = n.data;
  const base = { id: n.id, kind, x: n.position.x, y: n.position.y, color };
  if (isLineKind(kind)) return { ...base, points: points ?? [], strokeWidth };
  if (!isBoxKind(kind)) return { ...base, ...(text ? { text } : {}), fontSize };
  return {
    ...base,
    width: n.width ?? n.measured?.width ?? 240,
    height: n.height ?? n.measured?.height ?? 160,
    ...(rotation ? { rotation } : {}),
    ...(text ? { text } : {}),
    labelPosition,
    strokeWidth,
    fontSize,
  };
}

// ─── FlowState → LabSpecV2 ──────────────────────────────────────────────────
export function toLabSpec(input: {
  lab: { id: string; name: string; description: string };
  nodes: FlowNode[];
  edges: FlowEdge[];
  annotations: AnnotationNode[];
  viewport: { x: number; y: number; zoom: number };
}): LabSpecV2 {
  const nodes: LabSpecNode[] = input.nodes.map((n) => {
    const runtime: Record<string, unknown> = { ...n.data.nlc.runtime };
    return {
    id: n.id,
    type: n.data.nlc.type,
    name: n.data.nlc.name,
    vendor: n.data.nlc.vendor,
    profile: n.data.nlc.profile,
    image: n.data.nlc.image,
    runtime,
    interfaces: n.data.nlc.interfaces.map((iface) => ({
      family: iface.family,
      uiPrefix: iface.uiPrefix,
      slotCount: iface.slotCount,
      portsPerSlot: iface.portsPerSlot,
    })),
    };
  });

  const typeById = new Map(input.nodes.map((n) => [n.id, n.data.nlc.type]));
  const links: LabSpecLink[] = input.edges.map((e) => {
    const ep = e.data!.nlc.endpoints;
    const desc = e.data!.nlc.description ? { description: e.data!.nlc.description } : {};
    // A link touching a container is realized as a kernel veth pair (no netio/NETMAP).
    if (linkKind(typeById.get(e.source), typeById.get(e.target)) === "veth") {
      // Same endpoint shape as netio; container links are always ethernet, slot 0.
      return { id: e.id, kind: "veth", source: e.source, target: e.target,
        endpoints: [
          { family: "ethernet", slot: 0, port: ep[0].port },
          { family: "ethernet", slot: 0, port: ep[1].port },
        ], ...desc };
    }
    return { id: e.id, source: e.source, target: e.target,
      endpoints: [
        { family: ep[0].family, slot: ep[0].slot, port: ep[0].port },
        { family: ep[1].family, slot: ep[1].slot, port: ep[1].port },
      ], ...desc };
  });

  const ui: LabSpecUi = {
    viewport: input.viewport,
    nodes: Object.fromEntries(input.nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }])),
    edges: Object.fromEntries(
      input.edges
        .filter((e) => e.sourceHandle || e.targetHandle)
        .map((e) => [e.id, { sourceHandle: e.sourceHandle ?? "s-right", targetHandle: e.targetHandle ?? "t-left" }]),
    ),
    ...(input.annotations.length > 0 ? { annotations: input.annotations.map(fromAnnotationNode) } : {}),
  };

  return {
    lab: {
      id: input.lab.id,
      name: input.lab.name,
      ...(input.lab.description ? { description: input.lab.description } : {}),
    },
    nodes,
    links,
    ui,
  };
}

// ─── LabSpecV2 → FlowState ──────────────────────────────────────────────────
export function fromLabSpec(
  spec: LabSpecV2,
  profiles: Record<string, ProfileDef>,
): {
  lab: { id: string; name: string; description: string };
  nodes: FlowNode[];
  edges: FlowEdge[];
  annotations: AnnotationNode[];
  viewport: { x: number; y: number; zoom: number };
} {
  const nodePositions = spec.ui?.nodes ?? {};
  const edgeHandles = spec.ui?.edges ?? {};

  const nodes: FlowNode[] = spec.nodes.map((n, index) => {
    const profile = profiles[n.profile];
    const pos = nodePositions[n.id] ?? { x: 220 + index * 40, y: 240 + index * 20 };

    const interfaces: NlcInterface[] = n.interfaces.map((iface) => ({
      family: iface.family,
      uiPrefix: iface.uiPrefix,
      slotCount: iface.slotCount,
      portsPerSlot: iface.portsPerSlot,
    }));

    return {
      id: n.id,
      type: "device" as const,
      position: pos,
      data: {
        nlc: {
          type: n.type as NodeType,
          profile: n.profile,
          vendor: n.vendor,
          name: n.name,
          image: n.image,
          interfaces,
          runtime: { ...n.runtime },
        },
        ui: {
          icon: profile?.icon ?? "",
          pattern: profile?.pattern ?? "${uiPrefix}${slot}/${port}",
        },
      },
    };
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const edges: FlowEdge[] = (spec.links ?? []).map((link) => {
    const handles = edgeHandles[link.id] ?? {};
    const srcNode = nodeById.get(link.source);
    const tgtNode = nodeById.get(link.target);
    // Endpoints have the same {family, slot, port} shape for both kinds now.
    const [srcEp, tgtEp] = link.endpoints;

    return {
      id: link.id,
      source: link.source,
      target: link.target,
      sourceHandle: handles.sourceHandle ?? "s-right",
      targetHandle: handles.targetHandle ?? "t-left",
      type: "device" as const,
      data: {
        nlc: {
          endpoints: [
            {
              family: srcEp.family,
              slot: srcEp.slot,
              port: srcEp.port,
              uiPrefix: srcNode?.data.nlc.interfaces.find((i) => i.family === srcEp.family)?.uiPrefix ?? "",
            },
            {
              family: tgtEp.family,
              slot: tgtEp.slot,
              port: tgtEp.port,
              uiPrefix: tgtNode?.data.nlc.interfaces.find((i) => i.family === tgtEp.family)?.uiPrefix ?? "",
            },
          ],
          description: link.description ?? "",
        },
        ui: link.kind === "veth" ? { veth: true } : {},
      },
    };
  });

  return {
    lab: { id: spec.lab.id, name: spec.lab.name, description: spec.lab.description ?? "" },
    nodes,
    edges,
    annotations: (spec.ui?.annotations ?? []).map(toAnnotationNode),
    viewport: spec.ui?.viewport ?? { x: 0, y: 0, zoom: 1 },
  };
}
