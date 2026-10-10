"use client";

import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { Minus } from "lucide-react";
import type { FlowNode } from "@/lib/topo/types";
import { useTopoMode } from "./topo-mode";

function resolveIconSrc(icon?: string): string | null {
  if (!icon?.trim()) return null;
  const s = icon.trim();
  if (s.startsWith("/") || s.startsWith("http://") || s.startsWith("https://")) return s;
  return `/icons/${s}`;
}

export function DeviceNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { deleteElements } = useReactFlow();
  const { readonly } = useTopoMode();
  const iconSrc = resolveIconSrc(data.ui.icon);

  return (
    <div className="relative h-24 w-24 bg-transparent text-center">
      <div className={`relative inline-block ${selected ? "ring-1 ring-yellow-500" : ""}`}>
        {selected && !readonly && (
          <button
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex size-4 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-400 cursor-pointer"
            onClick={() => deleteElements({ nodes: [{ id }] })}
          >
            <Minus size={10} />
          </button>
        )}
        <div className="absolute bottom-1 z-10 flex w-full items-center justify-center">
          <p className="max-w-24 truncate rounded bg-black/20 px-1 text-xs font-bold whitespace-nowrap text-white" title={data.nlc.name}>
            {data.nlc.name}
          </p>
        </div>

        <Handle id="t-top" type="target" position={Position.Top} />
        <Handle id="s-top" type="source" position={Position.Top} />
        <Handle id="t-left" type="target" position={Position.Left} />
        <Handle id="s-left" type="source" position={Position.Left} />

        {iconSrc ? (
          <img src={iconSrc} alt="" aria-hidden className="h-24 w-24 object-contain" />
        ) : (
          <div className="h-24 w-24 rounded border bg-muted" />
        )}

        <Handle id="t-right" type="target" position={Position.Right} />
        <Handle id="s-right" type="source" position={Position.Right} />
        <Handle id="t-bottom" type="target" position={Position.Bottom} />
        <Handle id="s-bottom" type="source" position={Position.Bottom} />
      </div>
    </div>
  );
}
