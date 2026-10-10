"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps } from "@xyflow/react";
import { Minus } from "lucide-react";
import type { FlowEdge } from "@/lib/topo/types";
import { useTopoMode } from "./topo-mode";

function endpointLabelPositions(sourceX: number, sourceY: number, targetX: number, targetY: number, inset: number) {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  return {
    source: { x: sourceX + (dx / len) * inset, y: sourceY + (dy / len) * inset },
    target: { x: targetX - (dx / len) * inset, y: targetY - (dy / len) * inset },
  };
}

export function DeviceEdge(props: EdgeProps<FlowEdge>) {
  const { id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, selected, data } = props;
  const { deleteElements } = useReactFlow();
  const { readonly } = useTopoMode();

  const bundleCount = Number(data?.ui?.bundleCount ?? 1);
  const showInterface = Boolean(data?.ui?.showInterface);
  const sourceIfName = (data?.ui?.sourceIfName ?? "") as string;
  const targetIfName = (data?.ui?.targetIfName ?? "") as string;
  const family = (data?.nlc?.endpoints?.[0]?.family ?? "ethernet") as "ethernet" | "serial";
  const isVeth = Boolean(data?.ui?.veth);

  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const epPos = endpointLabelPositions(sourceX, sourceY, targetX, targetY, 20);

  const strokeClass = selected ? "stroke-yellow-500!" : isVeth ? "stroke-teal-600!" : family === "serial" ? "stroke-blue-600!" : "stroke-foreground!";

  return (
    <>
      <BaseEdge id={id} path={path}
        className={bundleCount > 1 ? `${strokeClass} stroke-2!` : strokeClass} />
      {bundleCount > 1 && <BaseEdge id={`${id}-bg`} path={path} className="stroke-background!" />}

      <EdgeLabelRenderer>
        <>
          {showInterface && (
            <>
              <IfLabel x={epPos.source.x} y={epPos.source.y} text={sourceIfName} />
              <IfLabel x={epPos.target.x} y={epPos.target.y} text={targetIfName} />
            </>
          )}
          {selected && !readonly && (
            <button
              className="nodrag nopan pointer-events-auto absolute flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-red-500 hover:bg-red-400 text-white cursor-pointer"
              style={{ left: labelX, top: labelY }}
              onClick={() => deleteElements({ edges: [{ id }] })}
            >
              <Minus size={10} />
            </button>
          )}
        </>
      </EdgeLabelRenderer>
    </>
  );
}

function IfLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <div
      className="nodrag nopan pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded bg-card/80 px-1 text-[10px] text-foreground/80 shadow-sm"
      style={{ left: x, top: y }}
    >
      {text}
    </div>
  );
}
