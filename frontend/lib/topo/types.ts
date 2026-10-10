import type { Edge, Node } from "@xyflow/react";

export type InterfaceFamily = "ethernet" | "serial";
export type HandleSide = "top" | "right" | "bottom" | "left";
export const HANDLE_SIDES: HandleSide[] = ["top", "right", "bottom", "left"];

// ─── React Flow node data ───────────────────────────────────────────────────

export interface NlcInterface {
  family: InterfaceFamily;
  uiPrefix: string;
  slotCount: number;
  portsPerSlot: number;
}

export type NodeType = "iou" | "ioulive86" | "container" | "qemu";
export type RuntimeValue = number | string;

export interface FlowNodeNlc {
  type: NodeType;
  profile: string;
  vendor: string;
  name: string;
  image: string;
  interfaces: NlcInterface[];
  runtime: Record<string, unknown>;
}

export interface FlowNodeUi {
  icon: string;
  pattern: string; // e.g. "${uiPrefix}${slot}/${port}"
}

export interface FlowNodeData {
  [key: string]: unknown;
  nlc: FlowNodeNlc;
  ui: FlowNodeUi;
}

// ─── React Flow edge data ───────────────────────────────────────────────────

export interface FlowEdgeEndpoint {
  family: InterfaceFamily;
  slot: number;
  port: number;
  uiPrefix: string;
}

export interface FlowEdgeNlc {
  endpoints: [FlowEdgeEndpoint, FlowEdgeEndpoint];
  description: string;
}

export interface FlowEdgeUi {
  sourceIfName?: string;
  targetIfName?: string;
  showInterface?: boolean;
  bundleCount?: number;
  veth?: boolean; // container link (kernel veth pair), not a netio adjacency
}

export interface FlowEdgeData {
  [key: string]: unknown;
  nlc: FlowEdgeNlc;
  ui: FlowEdgeUi;
}

export type FlowNode = Node<FlowNodeData, "device">;
export type FlowEdge = Edge<FlowEdgeData>;

// ─── Canvas annotations (display only, stored in ui.annotations) ────────────

export type AnnotationKind = "rect" | "ellipse" | "text" | "line" | "arrow";
export type LineKind = Extract<AnnotationKind, "line" | "arrow">;
export function isLineKind(kind: AnnotationKind): kind is LineKind {
  return kind === "line" || kind === "arrow";
}
export function isBoxKind(kind: AnnotationKind): kind is "rect" | "ellipse" {
  return kind === "rect" || kind === "ellipse";
}
export interface Point {
  x: number;
  y: number;
}
export const ANNOTATION_COLORS = ["gray", "blue", "green", "amber", "red"] as const;
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];
export const DEFAULT_ANNOTATION_FONT_SIZE = 14;
export const DEFAULT_STROKE_WIDTH = 2;
export const LABEL_POSITIONS = [
  "top-left", "top", "top-right",
  "left", "center", "right",
  "bottom-left", "bottom", "bottom-right",
] as const;
export type LabelPosition = (typeof LABEL_POSITIONS)[number];

export interface AnnotationData {
  [key: string]: unknown;
  kind: AnnotationKind;
  text: string;
  color: AnnotationColor;
  fontSize: number;
  strokeWidth: number; // unused by text
  rotation: number; // rect/ellipse only, clockwise degrees about the centre
  labelPosition: LabelPosition; // rect/ellipse only
  points?: Point[]; // line kinds only: [start, end] relative to the node position
}

export type AnnotationNode = Node<AnnotationData, "annotation">;
// Everything the editor/viewer canvas renders: devices plus annotations.
export type CanvasNode = FlowNode | AnnotationNode;

// ─── LabSpecV2 (mirrors backend schema) ────────────────────────────────────

export interface LabSpecNode {
  type: string;
  id: string;
  name: string;
  vendor: string;
  profile: string;
  image: string;
  runtime: Record<string, unknown>;
  interfaces: Array<{ family: InterfaceFamily; uiPrefix: string; slotCount: number; portsPerSlot: number }>;
}

export interface LinkEndpoint { family: InterfaceFamily; slot: number; port: number }
export interface LabSpecLink {
  id: string;
  // "veth" for links touching a container (direct kernel veth pair), else "netio"
  // (default when omitted). Same endpoint shape for both; a veth link uses family
  // "ethernet" and slot 0.
  kind?: "netio" | "veth";
  source: string;
  target: string;
  endpoints: [LinkEndpoint, LinkEndpoint];
  description?: string;
}

export interface LabSpecAnnotation {
  id: string;
  kind: AnnotationKind;
  x: number;
  y: number;
  width?: number; // rect/ellipse only; text sizes to its content, line kinds use points
  height?: number;
  rotation?: number; // rect/ellipse only
  points?: Point[]; // line kinds only, relative to (x, y)
  text?: string;
  labelPosition?: LabelPosition; // rect/ellipse only
  color?: AnnotationColor;
  strokeWidth?: number; // not text
  fontSize?: number;
}

export interface LabSpecUi {
  viewport: { x: number; y: number; zoom: number };
  nodes: Record<string, { x: number; y: number }>;
  edges: Record<string, { sourceHandle: string; targetHandle: string }>;
  annotations?: LabSpecAnnotation[];
}

export interface LabSpecV2 {
  $schema?: string;
  lab: { id: string; name: string; description?: string };
  nodes: LabSpecNode[];
  links?: LabSpecLink[];
  ui?: LabSpecUi;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

export function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (plain HTTP by IP), where randomUUID is
  // missing but getRandomValues is still available.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

export function formatInterfaceLabel(
  endpoint: Pick<FlowEdgeEndpoint, "uiPrefix" | "slot" | "port">,
  pattern: string,
): string {
  return pattern
    .replace(/\$\{uiPrefix\}/g, endpoint.uiPrefix)
    .replace(/\$\{slot\}/g, String(endpoint.slot))
    .replace(/\$\{port\}/g, String(endpoint.port));
}

export function applyEdgeType(edges: FlowEdge[]): FlowEdge[] {
  return edges.map((edge) => ({ ...edge, type: "device" as const }));
}

export function findSnapPosition(
  draggingNode: FlowNode,
  allNodes: FlowNode[],
  threshold = 12,
): { x: number | null; y: number | null } {
  let snapX: number | null = null;
  let snapY: number | null = null;
  let nearestX = threshold + 1;
  let nearestY = threshold + 1;

  for (const node of allNodes) {
    if (node.id === draggingNode.id) continue;
    const dx = Math.abs(node.position.x - draggingNode.position.x);
    const dy = Math.abs(node.position.y - draggingNode.position.y);
    if (dx < nearestX && dx <= threshold) { nearestX = dx; snapX = node.position.x; }
    if (dy < nearestY && dy <= threshold) { nearestY = dy; snapY = node.position.y; }
  }
  return { x: snapX, y: snapY };
}
