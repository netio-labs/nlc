"use client";

import { useState } from "react";
import { useReactFlow, type NodeProps } from "@xyflow/react";
import { useTranslations } from "next-intl";
import {
  arrowHead,
  lineNodeGeometry,
  linePath,
  resizeFromCorner,
  rotationToward,
  snap45,
} from "@/lib/topo/annotation-geometry";
import {
  isLineKind,
  type AnnotationColor,
  type AnnotationData,
  type AnnotationNode as AnnotationNodeType,
  type LabelPosition,
} from "@/lib/topo/types";
import { useTopoMode } from "./topo-mode";

interface PaletteEntry {
  stroke: string;
  fill: string; // translucent, for box/ellipse interiors
  solid: string; // opaque, for arrowheads
  text: string;
  swatch: string;
}
// Preset palette. Class strings are static so Tailwind picks them up; text gets a
// dark: variant because the canvas background flips with the theme.
export const ANNOTATION_STYLES: Record<AnnotationColor, PaletteEntry> = {
  gray: { stroke: "stroke-zinc-500", fill: "fill-zinc-500/10", solid: "fill-zinc-500", text: "text-zinc-600 dark:text-zinc-300", swatch: "bg-zinc-500" },
  blue: { stroke: "stroke-blue-500", fill: "fill-blue-500/10", solid: "fill-blue-500", text: "text-blue-600 dark:text-blue-400", swatch: "bg-blue-500" },
  green: { stroke: "stroke-green-600", fill: "fill-green-500/10", solid: "fill-green-600", text: "text-green-700 dark:text-green-400", swatch: "bg-green-600" },
  amber: { stroke: "stroke-amber-500", fill: "fill-amber-500/10", solid: "fill-amber-500", text: "text-amber-700 dark:text-amber-400", swatch: "bg-amber-500" },
  red: { stroke: "stroke-red-500", fill: "fill-red-500/10", solid: "fill-red-500", text: "text-red-600 dark:text-red-400", swatch: "bg-red-500" },
};

// Flex alignment (and multi-line text alignment) for each label position.
const LABEL_LAYOUT: Record<LabelPosition, string> = {
  "top-left": "items-start justify-start text-left",
  top: "items-start justify-center text-center",
  "top-right": "items-start justify-end text-right",
  left: "items-center justify-start text-left",
  center: "items-center justify-center text-center",
  right: "items-center justify-end text-right",
  "bottom-left": "items-end justify-start text-left",
  bottom: "items-end justify-center text-center",
  "bottom-right": "items-end justify-end text-right",
};

const MIN_SIZE = 40;
const ROTATE_SNAP = 15;
// Corners as (sx, sy) ∈ {-1, 1}², with their position and cursor classes.
const CORNERS = [
  { sx: -1, sy: -1, className: "-left-1 -top-1 cursor-nwse-resize" },
  { sx: 1, sy: -1, className: "-right-1 -top-1 cursor-nesw-resize" },
  { sx: -1, sy: 1, className: "-left-1 -bottom-1 cursor-nesw-resize" },
  { sx: 1, sy: 1, className: "-right-1 -bottom-1 cursor-nwse-resize" },
] as const;

// Pointer handlers for a drag handle: capture on press, report moves while
// captured. Stops propagation so xyflow doesn't start a node drag.
function dragHandlers(onMove: (e: React.PointerEvent) => void, onStart?: () => void) {
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      onStart?.();
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) onMove(e);
    },
  };
}

export function AnnotationNode(props: NodeProps<AnnotationNodeType>) {
  if (isLineKind(props.data.kind)) return <LineAnnotation {...props} />;
  if (props.data.kind === "text") return <TextAnnotation {...props} />;
  return <BoxAnnotation {...props} />;
}

// Label text, double-click to edit in place. Used for text annotations and for
// box/ellipse labels.
function EditableLabel({ id, data, placeholder }: { id: string; data: AnnotationData; placeholder?: string }) {
  const { readonly } = useTopoMode();
  const { updateNodeData } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const style = ANNOTATION_STYLES[data.color] ?? ANNOTATION_STYLES.gray;
  const textStyle = { fontSize: data.fontSize, lineHeight: 1.3 };

  if (editing) {
    return (
      <textarea
        autoFocus
        rows={Math.max(1, data.text.split("\n").length)}
        defaultValue={data.text}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          updateNodeData(id, { text: e.currentTarget.value });
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        style={textStyle}
        className={`nodrag nopan nowheel pointer-events-auto field-sizing-content min-w-16 resize-none rounded border border-ring bg-card/90 px-1 font-medium outline-none ${style.text}`}
      />
    );
  }
  if (!data.text && !placeholder) return null;
  return (
    <p
      onDoubleClick={() => !readonly && setEditing(true)}
      style={textStyle}
      className={`pointer-events-auto whitespace-pre px-1 font-medium ${style.text} ${readonly ? "" : "cursor-move"} ${data.text ? "" : "italic opacity-50"}`}
    >
      {data.text || placeholder}
    </p>
  );
}

function TextAnnotation({ id, data, selected }: NodeProps<AnnotationNodeType>) {
  const { readonly } = useTopoMode();
  const t = useTranslations("topo.annotation");
  return (
    <div className={`rounded ${selected && !readonly ? "outline-1 outline-dashed outline-ring" : ""}`}>
      <EditableLabel id={id} data={data} placeholder={t("textPlaceholder")} />
    </div>
  );
}

// rect / ellipse. The node frame stays axis-aligned; everything inside it (shape,
// label, handles) is rotated about the centre. Only the outline, label and handles
// take pointer events (the wrapper is pointer-events:none, see toAnnotationNode),
// so the interior stays click-through to the canvas and devices.
function BoxAnnotation({ id, data, selected, positionAbsoluteX, positionAbsoluteY, width, height }: NodeProps<AnnotationNodeType>) {
  const { readonly } = useTopoMode();
  const t = useTranslations("topo.annotation");
  const { screenToFlowPosition, updateNode, updateNodeData } = useReactFlow();
  const frame = { x: positionAbsoluteX, y: positionAbsoluteY, width: width ?? 0, height: height ?? 0 };
  // Frame at the start of a resize/rotate drag; resizing anchors on it.
  const [dragStart, setDragStart] = useState(frame);
  const style = ANNOTATION_STYLES[data.color] ?? ANNOTATION_STYLES.gray;
  const editable = selected && !readonly;

  const Shape = data.kind === "ellipse" ? "ellipse" : "rect";
  const geometry =
    data.kind === "ellipse" ? { cx: "50%", cy: "50%", rx: "50%", ry: "50%" } : { x: 0, y: 0, width: "100%", height: "100%", rx: 8 };

  const snapshot = () => setDragStart(frame);

  return (
    <div className="absolute inset-0" style={{ transform: `rotate(${data.rotation}deg)` }}>
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        <Shape {...geometry} className={`${style.stroke} ${style.fill}`} strokeWidth={data.strokeWidth} pointerEvents="none" />
        {!readonly && (
          <Shape {...geometry} fill="none" stroke="transparent" strokeWidth={Math.max(12, data.strokeWidth + 10)} pointerEvents="stroke" className="cursor-move" />
        )}
      </svg>
      <div className={`pointer-events-none absolute inset-0 flex px-2 py-1 ${LABEL_LAYOUT[data.labelPosition]}`}>
        <EditableLabel id={id} data={data} />
      </div>
      {editable && (
        <>
          {CORNERS.map(({ sx, sy, className }) => (
            <div
              key={`${sx}${sy}`}
              className={`nodrag pointer-events-auto absolute size-2.5 rounded-sm border border-ring bg-card ${className}`}
              {...dragHandlers((e) => {
                const pointer = screenToFlowPosition({ x: e.clientX, y: e.clientY });
                const next = resizeFromCorner(dragStart, data.rotation, sx, sy, pointer, MIN_SIZE);
                updateNode(id, { position: next.position, width: next.width, height: next.height });
              }, snapshot)}
            />
          ))}
          <div className="pointer-events-none absolute -top-6 left-1/2 h-6 w-px -translate-x-1/2 bg-ring" />
          <div
            title={t("rotate")}
            className="nodrag pointer-events-auto absolute -top-8 left-1/2 size-3 -translate-x-1/2 cursor-grab rounded-full border border-ring bg-card"
            {...dragHandlers((e) => {
              const center = { x: dragStart.x + dragStart.width / 2, y: dragStart.y + dragStart.height / 2 };
              const pointer = screenToFlowPosition({ x: e.clientX, y: e.clientY });
              updateNodeData(id, { rotation: rotationToward(center, pointer, e.shiftKey ? ROTATE_SNAP : undefined) });
            }, snapshot)}
          />
        </>
      )}
    </div>
  );
}

// line / arrow. Only the stroke (widened by a transparent hit path) is
// interactive; the wrapper is pointer-events:none like boxes. When selected, a
// handle at each end drags that endpoint (Shift snaps to 45°).
function LineAnnotation({ id, data, selected, positionAbsoluteX, positionAbsoluteY }: NodeProps<AnnotationNodeType>) {
  const { readonly } = useTopoMode();
  const { screenToFlowPosition, updateNode } = useReactFlow();
  const style = ANNOTATION_STYLES[data.color] ?? ANNOTATION_STYLES.gray;
  const points = data.points ?? [];
  const head = data.kind === "arrow" ? arrowHead(points, data.strokeWidth) : null;
  const shaft = head ? [...points.slice(0, -1), head.shaftEnd] : points;

  function moveEndpoint(index: number, e: React.PointerEvent) {
    const absolute = points.map((p) => ({ x: p.x + positionAbsoluteX, y: p.y + positionAbsoluteY }));
    const pointer = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const anchor = absolute[index === 0 ? absolute.length - 1 : 0];
    absolute[index] = e.shiftKey ? snap45(anchor, pointer) : pointer;
    const geometry = lineNodeGeometry(absolute);
    updateNode(id, {
      position: geometry.position,
      width: geometry.width,
      height: geometry.height,
      data: { ...data, points: geometry.points },
    });
  }

  return (
    <svg className="absolute inset-0 h-full w-full overflow-visible">
      <path d={linePath(shaft)} fill="none" className={style.stroke} strokeWidth={data.strokeWidth} strokeLinecap="round" pointerEvents="none" />
      {head && <polygon points={head.polygon} className={`${style.stroke} ${style.solid}`} strokeWidth={1} strokeLinejoin="round" pointerEvents="none" />}
      {!readonly && (
        <path d={linePath(points)} fill="none" stroke="transparent" strokeWidth={Math.max(14, data.strokeWidth + 10)} pointerEvents="stroke" className="cursor-move" />
      )}
      {selected &&
        !readonly &&
        points.map((p, index) => (
          <circle
            key={index}
            cx={p.x}
            cy={p.y}
            r={5}
            pointerEvents="all"
            className="nodrag cursor-crosshair fill-card stroke-ring"
            strokeWidth={1.5}
            {...dragHandlers((e) => moveEndpoint(index, e))}
          />
        ))}
    </svg>
  );
}
