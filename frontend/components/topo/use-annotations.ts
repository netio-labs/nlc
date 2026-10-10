"use client";

import { useCallback, useMemo, useState } from "react";
import { applyNodeChanges, type NodeChange, type OnNodesChange } from "@xyflow/react";
import type { AnnotationNode, CanvasNode, FlowNode } from "@/lib/topo/types";

// Annotations share the canvas with devices but live in their own state, so device
// logic never sees them. The returned onNodesChange routes each canvas change
// (drag, select, resize, remove, data edit) to whichever state owns the node.
export function useAnnotations(initial: AnnotationNode[], onDeviceNodesChange: OnNodesChange<FlowNode>) {
  const [annotations, setAnnotations] = useState(initial);
  const ids = useMemo(() => new Set(annotations.map((a) => a.id)), [annotations]);

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const isAnnotation = (c: NodeChange<CanvasNode>) => ids.has(c.type === "add" ? c.item.id : c.id);
      const annotationChanges = changes.filter(isAnnotation) as NodeChange<AnnotationNode>[];
      const deviceChanges = changes.filter((c) => !isAnnotation(c)) as NodeChange<FlowNode>[];
      if (annotationChanges.length > 0) setAnnotations((cur) => applyNodeChanges(annotationChanges, cur));
      if (deviceChanges.length > 0) onDeviceNodesChange(deviceChanges);
    },
    [ids, onDeviceNodesChange],
  );

  return { annotations, setAnnotations, onNodesChange };
}
