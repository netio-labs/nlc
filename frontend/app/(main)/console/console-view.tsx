"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { ConsoleTerminal } from "./terminal";

interface NodeInfo {
  id: string;
  name: string;
}

interface ConsoleViewProps {
  labId: string;
  nodes: NodeInfo[];
  wsBaseUrl: string;
}

export function ConsoleView({ labId, nodes, wsBaseUrl }: ConsoleViewProps) {
  const t = useTranslations("console");
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [activatedNodes, setActivatedNodes] = useState<Set<string>>(new Set());
  const [resetKeys, setResetKeys] = useState<Record<string, number>>({});

  function handleTabClick(nodeId: string) {
    setActiveNodeId(nodeId);
    setActivatedNodes((prev) => new Set([...prev, nodeId]));
  }

  function handleReset(e: React.MouseEvent, nodeId: string) {
    e.stopPropagation();
    setActiveNodeId(nodeId);
    setActivatedNodes((prev) => new Set([...prev, nodeId]));
    setResetKeys((prev) => ({ ...prev, [nodeId]: (prev[nodeId] ?? 0) + 1 }));
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-zinc-900">
      {/* Tab bar */}
      <div className="flex shrink-0 items-center overflow-x-auto border-b border-zinc-700 bg-zinc-800 px-2 pt-1">
        {nodes.map((node, i) => (
          <div key={node.id} className="flex items-stretch">
            {i > 0 && <div className="w-px self-stretch bg-zinc-600" />}
            <div
              className={`flex items-center gap-4 rounded-t px-3 py-1.5 text-xs cursor-pointer select-none ${
                node.id === activeNodeId
                  ? "bg-zinc-900 text-yellow-400 font-semibold"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              onClick={() => handleTabClick(node.id)}
            >
              <span>{node.name}</span>
              <button
                className="opacity-40 hover:opacity-100 cursor-pointer"
                title={t("resetReconnect")}
                onClick={(e) => handleReset(e, node.id)}
              >
                <RotateCcw size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Terminal area */}
      <div className="min-h-0 flex-1">
        {activeNodeId === null ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            {t("clickTab")}
          </div>
        ) : (
          nodes.map((node) => (
            <div key={node.id} className={`h-full ${node.id === activeNodeId ? "block" : "hidden"}`}>
              {activatedNodes.has(node.id) && (
                <ConsoleTerminal
                  key={`${node.id}-${resetKeys[node.id] ?? 0}`}
                  labId={labId}
                  nodeId={node.id}
                  wsBaseUrl={wsBaseUrl}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
