"use client";

import { useEffect, useRef, useState } from "react";
import { arrowHead, linePath, snap45 } from "@/lib/topo/annotation-geometry";
import { DEFAULT_STROKE_WIDTH, type LineKind, type Point } from "@/lib/topo/types";

// Strokes shorter than this (screen px) are treated as a stray click.
const MIN_LENGTH = 4;

interface AnnotationDrawLayerProps {
  tool: LineKind;
  screenToFlowPosition: (p: Point) => Point;
  onDraw: (kind: LineKind, flowPoints: Point[]) => void;
  onCancel: () => void;
}

// Transparent overlay above the canvas while a line tool is active: press and drag
// to draw (Shift snaps to 45°), Esc cancels. Preview is drawn in screen space; the
// finished segment is handed back in flow coordinates.
export function AnnotationDrawLayer({ tool, screenToFlowPosition, onDraw, onCancel }: AnnotationDrawLayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<Point[] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function local(e: React.PointerEvent): Point {
    const rect = ref.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function finish(stroke: Point[]) {
    setPoints(null);
    const [start, end] = stroke;
    if (Math.hypot(end.x - start.x, end.y - start.y) < MIN_LENGTH) return;
    const rect = ref.current!.getBoundingClientRect();
    onDraw(tool, stroke.map((p) => screenToFlowPosition({ x: p.x + rect.left, y: p.y + rect.top })));
  }

  const head = tool === "arrow" && points ? arrowHead(points, DEFAULT_STROKE_WIDTH) : null;

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-10 cursor-crosshair touch-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = local(e);
        setPoints([p, p]);
      }}
      onPointerMove={(e) => {
        if (!points) return;
        const p = local(e);
        setPoints([points[0], e.shiftKey ? snap45(points[0], p) : p]);
      }}
      onPointerUp={() => points && finish(points)}
    >
      {points && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
          <path d={linePath(points)} fill="none" className="stroke-foreground/60" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {head && <polygon points={head.polygon} className="fill-foreground/60" />}
        </svg>
      )}
    </div>
  );
}
