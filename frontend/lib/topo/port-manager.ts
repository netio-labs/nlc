import type { FlowEdge, FlowNode, FlowNodeData, InterfaceFamily, NlcInterface, NodeType } from "./types";

/**
 * How a link is realized: a container end makes it a kernel veth pair, anything
 * else is a netio adjacency. Every port accepts exactly one kind:
 *   - container ports           → veth
 *   - ioulive86 port 0 (e0/0)    → netio (its IOU side)
 *   - ioulive86 port 1 (e0/1)    → veth  (container side; exists only in auto mode)
 *   - every other node's ports   → netio
 * so "container ↔ IOU" has no common port and "one container per bridge" is just
 * the capacity of e0/1 — no special cases outside this module.
 */
export type LinkKind = "netio" | "veth";

export function linkKind(a: NodeType | undefined, b: NodeType | undefined): LinkKind {
  return a === "container" || b === "container" ? "veth" : "netio";
}

function portKind(type: NodeType, ref: PortRef): LinkKind {
  if (type === "container") return "veth";
  if (type === "ioulive86") return ref.port === 0 ? "netio" : "veth";
  return "netio";
}

export interface PortRef {
  family: InterfaceFamily;
  slot: number;
  port: number;
  uiPrefix: string;
}

type PortState = "free" | "used";

interface PortRow {
  nodeId: string;
  key: string;
  family: InterfaceFamily;
  slot: number;
  port: number;
  uiPrefix: string;
  kind: LinkKind;
  state: PortState;
  edgeId: string | null;
  remoteNodeId: string | null;
  remoteKey: string | null;
}

interface EdgeBinding {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceRef: PortRef;
  targetRef: PortRef;
  family: InterfaceFamily;
}

export interface UpdateNodeResult {
  invalidEdgeIds: string[];
  error: string | null;
}

function cloneRef(ref: PortRef): PortRef {
  return { family: ref.family, slot: ref.slot, port: ref.port, uiPrefix: ref.uiPrefix };
}

function toInt(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeInterfaces(value: NlcInterface[]): NlcInterface[] {
  return value.map((src) => ({
    family: src.family,
    uiPrefix: src.uiPrefix,
    slotCount: Math.max(0, toInt(src.slotCount, 0)),
    portsPerSlot: Math.max(0, toInt(src.portsPerSlot, 0)),
  }));
}

function buildPortRefs(interfaces: NlcInterface[]): PortRef[] {
  const ports: PortRef[] = [];
  let nextSlot = 0;

  for (const item of interfaces) {
    if (item.family !== "ethernet" && item.family !== "serial") continue;

    const slotCount = Math.max(0, toInt(item.slotCount, 0));
    const portsPerSlot = Math.max(0, toInt(item.portsPerSlot, 0));
    if (slotCount === 0 || portsPerSlot === 0) continue;

    const startSlot = nextSlot;
    const endSlot = startSlot + slotCount;

    for (let slot = startSlot; slot < endSlot; slot++) {
      for (let port = 0; port < portsPerSlot; port++) {
        ports.push({ family: item.family, slot, port, uiPrefix: item.uiPrefix });
      }
    }
    nextSlot = endSlot;
  }
  return ports;
}

export function portRefKey(ref: Pick<PortRef, "family" | "slot" | "port">): string {
  return `${ref.family}:${ref.slot}/${ref.port}`;
}

function edgeBindingFromFlowEdge(edge: FlowEdge): EdgeBinding | null {
  const src = edge.data?.nlc?.endpoints?.[0];
  const tgt = edge.data?.nlc?.endpoints?.[1];
  if (!src || !tgt || src.family !== tgt.family) return null;
  return {
    edgeId: edge.id,
    sourceNodeId: edge.source,
    targetNodeId: edge.target,
    sourceRef: { family: src.family, slot: src.slot, port: src.port, uiPrefix: src.uiPrefix ?? "" },
    targetRef: { family: tgt.family, slot: tgt.slot, port: tgt.port, uiPrefix: tgt.uiPrefix ?? "" },
    family: src.family,
  };
}

export class PortManager {
  private readonly rows = new Map<string, PortRow>();
  private readonly bindings = new Map<string, EdgeBinding>();
  private readonly edgesByNode = new Map<string, Set<string>>();
  private readonly nodeTypes = new Map<string, NodeType>();

  private pk(nodeId: string, key: string): string {
    return `${nodeId}|${key}`;
  }

  private ensureNodeIndex(nodeId: string): void {
    if (!this.edgesByNode.has(nodeId)) this.edgesByNode.set(nodeId, new Set());
  }

  private insertNode(node: FlowNode): void {
    this.ensureNodeIndex(node.id);
    const type = node.data.nlc.type;
    this.nodeTypes.set(node.id, type);
    const refs = buildPortRefs(normalizeInterfaces(node.data.nlc.interfaces));
    for (const ref of refs) {
      const key = portRefKey(ref);
      this.rows.set(this.pk(node.id, key), {
        nodeId: node.id, key,
        family: ref.family, slot: ref.slot, port: ref.port, uiPrefix: ref.uiPrefix, kind: portKind(type, ref),
        state: "free", edgeId: null, remoteNodeId: null, remoteKey: null,
      });
    }
  }

  private kindOf(srcNodeId: string, tgtNodeId: string): LinkKind {
    return linkKind(this.nodeTypes.get(srcNodeId), this.nodeTypes.get(tgtNodeId));
  }

  private removeNode(nodeId: string): void {
    for (const [pk, row] of this.rows) {
      if (row.nodeId === nodeId) this.rows.delete(pk);
    }
    this.edgesByNode.delete(nodeId);
    this.nodeTypes.delete(nodeId);
  }

  private getRow(nodeId: string, key: string): PortRow | null {
    return this.rows.get(this.pk(nodeId, key)) ?? null;
  }

  private reservePort(nodeId: string, ref: PortRef, kind: LinkKind, edgeId: string, remoteNodeId: string, remoteRef: PortRef): boolean {
    const row = this.getRow(nodeId, portRefKey(ref));
    if (!row || row.state !== "free" || row.kind !== kind) return false;
    row.state = "used";
    row.edgeId = edgeId;
    row.remoteNodeId = remoteNodeId;
    row.remoteKey = portRefKey(remoteRef);
    this.rows.set(this.pk(nodeId, row.key), row);
    return true;
  }

  private releasePort(nodeId: string, ref: PortRef, edgeId: string): void {
    const row = this.getRow(nodeId, portRefKey(ref));
    if (!row || row.edgeId !== edgeId) return;
    row.state = "free";
    row.edgeId = null;
    row.remoteNodeId = null;
    row.remoteKey = null;
    this.rows.set(this.pk(nodeId, row.key), row);
  }

  private tryBind(binding: EdgeBinding): boolean {
    const kind = this.kindOf(binding.sourceNodeId, binding.targetNodeId);
    const srcOk = this.reservePort(binding.sourceNodeId, binding.sourceRef, kind, binding.edgeId, binding.targetNodeId, binding.targetRef);
    if (!srcOk) return false;
    const tgtOk = this.reservePort(binding.targetNodeId, binding.targetRef, kind, binding.edgeId, binding.sourceNodeId, binding.sourceRef);
    if (!tgtOk) {
      this.releasePort(binding.sourceNodeId, binding.sourceRef, binding.edgeId);
      return false;
    }
    this.bindings.set(binding.edgeId, { ...binding, sourceRef: cloneRef(binding.sourceRef), targetRef: cloneRef(binding.targetRef) });
    this.ensureNodeIndex(binding.sourceNodeId);
    this.ensureNodeIndex(binding.targetNodeId);
    this.edgesByNode.get(binding.sourceNodeId)!.add(binding.edgeId);
    this.edgesByNode.get(binding.targetNodeId)!.add(binding.edgeId);
    return true;
  }

  reset(nodes: FlowNode[], edges: FlowEdge[]): string | null {
    this.rows.clear();
    this.bindings.clear();
    this.edgesByNode.clear();
    this.nodeTypes.clear();
    try {
      for (const node of nodes) this.insertNode(node);
    } catch (err) {
      return err instanceof Error ? err.message : "Failed to build node ports.";
    }
    for (const edge of edges) {
      const binding = edgeBindingFromFlowEdge(edge);
      if (binding) this.tryBind(binding);
    }
    return null;
  }

  registerNode(node: FlowNode): string | null {
    try { this.insertNode(node); return null; }
    catch (err) { return err instanceof Error ? err.message : "Failed to build node ports."; }
  }

  unregisterNode(nodeId: string): string[] {
    const edgeIds = [...(this.edgesByNode.get(nodeId) ?? [])];
    for (const edgeId of edgeIds) this.releaseEdge(edgeId);
    this.removeNode(nodeId);
    return edgeIds;
  }

  updateNode(node: FlowNode): UpdateNodeResult {
    const edgeIds = [...(this.edgesByNode.get(node.id) ?? [])];
    const savedBindings = edgeIds.map((id) => this.bindings.get(id)).filter((b): b is EdgeBinding => Boolean(b));
    for (const id of edgeIds) this.releaseEdge(id);
    this.removeNode(node.id);
    try { this.insertNode(node); }
    catch (err) {
      return { invalidEdgeIds: edgeIds, error: err instanceof Error ? err.message : "Failed to build node ports." };
    }
    const invalidEdgeIds: string[] = [];
    for (const binding of savedBindings) {
      const nodeRef = binding.sourceNodeId === node.id ? binding.sourceRef : binding.targetRef;
      if (!this.getRow(node.id, portRefKey(nodeRef)) || !this.tryBind(binding)) {
        invalidEdgeIds.push(binding.edgeId);
      }
    }
    return { invalidEdgeIds, error: null };
  }

  allocateNextPair(edgeId: string, srcNodeId: string, tgtNodeId: string, family: InterfaceFamily): { sourceRef: PortRef; targetRef: PortRef } | null {
    if (this.bindings.has(edgeId)) this.releaseEdge(edgeId);
    const kind = this.kindOf(srcNodeId, tgtNodeId);
    const srcRef = this.freePorts(srcNodeId, family, kind)[0];
    const tgtRef = this.freePorts(tgtNodeId, family, kind)[0];
    if (!srcRef || !tgtRef) return null;
    const ok = this.tryBind({ edgeId, sourceNodeId: srcNodeId, targetNodeId: tgtNodeId, sourceRef: srcRef, targetRef: tgtRef, family });
    if (!ok) return null;
    return { sourceRef: cloneRef(srcRef), targetRef: cloneRef(tgtRef) };
  }

  allocateFirstAvailablePair(
    edgeId: string,
    srcNodeId: string,
    tgtNodeId: string,
    familyPriority: InterfaceFamily[] = ["ethernet", "serial"],
  ): { family: InterfaceFamily; sourceRef: PortRef; targetRef: PortRef } | null {
    for (const family of familyPriority) {
      const allocation = this.allocateNextPair(edgeId, srcNodeId, tgtNodeId, family);
      if (allocation) return { family, ...allocation };
    }
    return null;
  }

  retypeEdge(edgeId: string, nextFamily: InterfaceFamily): { sourceRef: PortRef; targetRef: PortRef } | null {
    const released = this.releaseEdge(edgeId);
    if (!released) return null;
    const allocated = this.allocateNextPair(edgeId, released.sourceNodeId, released.targetNodeId, nextFamily);
    if (allocated) return allocated;
    this.tryBind(released);
    return null;
  }

  updateEdgePort(edgeId: string, endpoint: "source" | "target", nextRef: PortRef): boolean {
    const binding = this.bindings.get(edgeId);
    if (!binding || nextRef.family !== binding.family) return false;
    const nextBinding: EdgeBinding = {
      ...binding,
      sourceRef: endpoint === "source" ? cloneRef(nextRef) : cloneRef(binding.sourceRef),
      targetRef: endpoint === "target" ? cloneRef(nextRef) : cloneRef(binding.targetRef),
    };
    const released = this.releaseEdge(edgeId);
    if (!released) return false;
    if (this.tryBind(nextBinding)) return true;
    this.tryBind(released);
    return false;
  }

  releaseEdge(edgeId: string): EdgeBinding | null {
    const binding = this.bindings.get(edgeId);
    if (!binding) return null;
    this.releasePort(binding.sourceNodeId, binding.sourceRef, edgeId);
    this.releasePort(binding.targetNodeId, binding.targetRef, edgeId);
    this.bindings.delete(edgeId);
    this.edgesByNode.get(binding.sourceNodeId)?.delete(edgeId);
    this.edgesByNode.get(binding.targetNodeId)?.delete(edgeId);
    return { ...binding, sourceRef: cloneRef(binding.sourceRef), targetRef: cloneRef(binding.targetRef) };
  }

  /** Free ports of a node that accept a link of this family and kind, in order. */
  private freePorts(nodeId: string, family: InterfaceFamily, kind: LinkKind): PortRef[] {
    const out: PortRef[] = [];
    for (const row of this.rows.values()) {
      if (row.nodeId !== nodeId || row.family !== family || row.kind !== kind || row.state !== "free") continue;
      out.push({ family: row.family, slot: row.slot, port: row.port, uiPrefix: row.uiPrefix });
    }
    return out.sort((a, b) => a.slot === b.slot ? a.port - b.port : a.slot - b.slot);
  }

  /** Ports one end of an existing edge could move to: its current port plus free ports of the edge's kind. */
  getAvailablePorts(nodeId: string, family: InterfaceFamily, edgeId: string): PortRef[] {
    const b = this.bindings.get(edgeId);
    if (!b) return [];
    const map = new Map<string, PortRef>();
    for (const ref of this.freePorts(nodeId, family, this.kindOf(b.sourceNodeId, b.targetNodeId))) map.set(portRefKey(ref), ref);
    for (const [nodeRef, side] of [[b.sourceNodeId, b.sourceRef], [b.targetNodeId, b.targetRef]] as const) {
      if (nodeRef === nodeId && b.family === family && this.getRow(nodeId, portRefKey(side))) map.set(portRefKey(side), cloneRef(side));
    }
    return [...map.values()].sort((a, b) => a.slot === b.slot ? a.port - b.port : a.slot - b.slot);
  }

  // Needed by the old code for FlowNodeData type — not used directly by the new types
  updateNodeData(node: { id: string; data: FlowNodeData }): UpdateNodeResult {
    return this.updateNode(node as FlowNode);
  }
}
