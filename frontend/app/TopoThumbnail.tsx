import { useTranslations } from "next-intl";
import type { LabSpecV2 } from "@/lib/topo/types";

const W = 280;
const H = 158;
const PAD = 22;
const NODE_R = 5;
// Rotated-square half-side chosen so the diamond's vertices reach the same
// distance from center as a dot's radius — same outer size as the dots.
const DIAMOND_HALF = NODE_R / Math.SQRT2;

function computePositions(spec: LabSpecV2): Map<string, { x: number; y: number }> {
  const n = spec.nodes.length;
  if (n === 0) return new Map();

  if (spec.ui?.nodes && Object.keys(spec.ui.nodes).length > 0) {
    const entries = Object.entries(spec.ui.nodes);
    const xs = entries.map(([, p]) => p.x);
    const ys = entries.map(([, p]) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const scaleX = (W - PAD * 2) / rangeX;
    const scaleY = (H - PAD * 2) / rangeY;
    const scale = Math.min(scaleX, scaleY);
    const scaledW = rangeX * scale;
    const scaledH = rangeY * scale;
    const ox = (W - scaledW) / 2;
    const oy = (H - scaledH) / 2;
    return new Map(
      entries.map(([id, p]) => [
        id,
        { x: ox + (p.x - minX) * scale, y: oy + (p.y - minY) * scale },
      ]),
    );
  }

  // Fallback: circular layout
  if (n === 1) return new Map([[spec.nodes[0].id, { x: W / 2, y: H / 2 }]]);
  const cx = W / 2;
  const cy = H / 2;
  const r = Math.min(W, H) / 2 - PAD;
  return new Map(
    spec.nodes.map((node, i) => [
      node.id,
      {
        x: cx + r * Math.cos((2 * Math.PI * i) / n - Math.PI / 2),
        y: cy + r * Math.sin((2 * Math.PI * i) / n - Math.PI / 2),
      },
    ]),
  );
}

interface Props {
  spec: LabSpecV2 | null;
}

const BG = (
  <>
    <defs>
      <pattern id="dots" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="0.8" className="fill-muted-foreground/40" />
      </pattern>
    </defs>
    <rect width={W} height={H} className="fill-background" />
    <rect width={W} height={H} fill="url(#dots)" />
  </>
);

export function TopoThumbnail({ spec }: Props) {
  const t = useTranslations("home");
  if (!spec || spec.nodes.length === 0) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        {BG}
        <text x={W / 2} y={H / 2 + 4} textAnchor="middle" className="fill-muted-foreground/50" fontSize="11" fontFamily="sans-serif">
          {t("noNodes")}
        </text>
      </svg>
    );
  }

  const positions = computePositions(spec);
  const links = spec.links ?? [];

  // Deduplicate parallel links between the same node pair for cleaner rendering
  const drawnPairs = new Set<string>();
  const dedupedLinks = links.filter((l) => {
    if (l.source === l.target) return false; // skip self-loops
    const key = [l.source, l.target].sort().join("::");
    if (drawnPairs.has(key)) return false;
    drawnPairs.add(key);
    return true;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
      {BG}

      {/* Edges */}
      {dedupedLinks.map((link) => {
        const src = positions.get(link.source);
        const tgt = positions.get(link.target);
        if (!src || !tgt) return null;
        return (
          <line
            key={link.id}
            x1={src.x}
            y1={src.y}
            x2={tgt.x}
            y2={tgt.y}
            className="stroke-muted-foreground/70"
            strokeWidth="1"
          />
        );
      })}

      {/* Nodes: every device is a colored dot; ioulive86 is a blue diamond. */}
      {spec.nodes.map((node) => {
        const pos = positions.get(node.id);
        if (!pos) return null;

        // ioulive86 bridge — diamond in the icon's blue.
        if (node.type === "ioulive86") {
          return (
            <rect
              key={node.id}
              x={pos.x - DIAMOND_HALF}
              y={pos.y - DIAMOND_HALF}
              width={DIAMOND_HALF * 2}
              height={DIAMOND_HALF * 2}
              rx="1"
              fill="#3871AA"
              transform={`rotate(45 ${pos.x} ${pos.y})`}
            />
          );
        }

        // All other devices — a dot, colored by kind.
        const color =
          node.type === "container" ? "#ef4444" // red
          : node.profile === "iouRouter" ? "#22c55e" // green
          : node.profile === "iouSwitch" ? "#f59e0b" // amber
          : node.profile === "vpc" ? "#a855f7" // purple
          : "#71717a"; // fallback grey
        return <circle key={node.id} cx={pos.x} cy={pos.y} r={NODE_R} fill={color} />;
      })}
    </svg>
  );
}
