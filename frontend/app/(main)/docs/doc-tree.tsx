"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { TreeNode } from "./tree";

function FileNode({ node, currentFile }: { node: TreeNode; currentFile: string }) {
  const isActive = node.path === currentFile;
  return (
    <Link
      href={`/docs?file=${encodeURIComponent(node.path)}`}
      className={`block truncate rounded px-2 py-1 text-sm ${
        isActive
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      }`}
      title={node.title}
    >
      {node.title}
    </Link>
  );
}

type DirKey = Parameters<ReturnType<typeof useTranslations<"docs.dirs">>>[0];

function DirNode({ node, currentFile, depth }: { node: TreeNode; currentFile: string; depth: number }) {
  // auto-open if current file is inside this directory
  const containsCurrent = node.children?.some((c) =>
    c.type === "file" ? c.path === currentFile : currentFile.startsWith(c.path + "/"),
  );
  const [open, setOpen] = useState(containsCurrent ?? depth === 0);
  const t = useTranslations("docs.dirs");

  return (
    <div>
      <button
        className="flex w-full cursor-pointer items-center gap-1 rounded px-2 py-1 text-left text-sm font-semibold text-foreground/80 hover:bg-accent"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-xs text-muted-foreground/70">{open ? "▾" : "▸"}</span>
        {t.has(node.name as DirKey) ? t(node.name as DirKey) : node.name}
      </button>
      {open && (
        <div className="ml-3 border-l border-border pl-2">
          {node.children!.map((child) =>
            child.type === "dir" ? (
              <DirNode key={child.path} node={child} currentFile={currentFile} depth={depth + 1} />
            ) : (
              <FileNode key={child.path} node={child} currentFile={currentFile} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

interface DocTreeProps {
  tree: TreeNode[];
  currentFile: string;
}

export function DocTree({ tree, currentFile }: DocTreeProps) {
  return (
    <nav className="space-y-0.5">
      {tree.map((node) =>
        node.type === "dir" ? (
          <DirNode key={node.path} node={node} currentFile={currentFile} depth={0} />
        ) : (
          <FileNode key={node.path} node={node} currentFile={currentFile} />
        ),
      )}
    </nav>
  );
}
