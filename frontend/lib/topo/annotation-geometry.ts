import type { Point } from "./types";

// Room around a line's endpoints for stroke width, arrowhead and the click target.
const LINE_PAD = 12;
const ARROW_SPREAD = Math.PI / 7;

// Node geometry (position, size, relative endpoints) for a line annotation whose
// endpoints are given in flow coordinates.
export function lineNodeGeometry(absolute: Point[]) {
  const xs = absolute.map((p) => p.x);
  const ys = absolute.map((p) => p.y);
  const position = { x: Math.min(...xs) - LINE_PAD, y: Math.min(...ys) - LINE_PAD };
  return {
    position,
    width: Math.max(...xs) - position.x + LINE_PAD,
    height: Math.max(...ys) - position.y + LINE_PAD,
    points: absolute.map((p) => ({ x: p.x - position.x, y: p.y - position.y })),
  };
}

// Constrain `to` so the segment from `from` is horizontal, vertical or diagonal.
export function snap45(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len };
}

export function linePath(points: Point[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return `M${first.x},${first.y}` + rest.map((p) => ` L${p.x},${p.y}`).join("");
}

// Arrowhead triangle at the end of the last segment, sized to the stroke, plus
// where the shaft should stop so its end doesn't poke through the tip.
export function arrowHead(points: Point[], strokeWidth: number): { polygon: string; shaftEnd: Point } | null {
  if (points.length < 2) return null;
  const size = 8 + strokeWidth * 2;
  const tip = points[points.length - 1];
  const from = points[points.length - 2];
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const corner = (a: number) => `${tip.x - size * Math.cos(a)},${tip.y - size * Math.sin(a)}`;
  const back = size * Math.cos(ARROW_SPREAD);
  return {
    polygon: `${tip.x},${tip.y} ${corner(angle - ARROW_SPREAD)} ${corner(angle + ARROW_SPREAD)}`,
    shaftEnd: { x: tip.x - back * Math.cos(angle), y: tip.y - back * Math.sin(angle) },
  };
}

// ─── Rotated boxes ───────────────────────────────────────────────────────────
// A rect/ellipse node keeps an unrotated frame (position = top-left, width,
// height); its content is rotated by `rotation` degrees about the frame centre.

export function rotate(v: Point, degrees: number): Point {
  const r = (degrees * Math.PI) / 180;
  return { x: v.x * Math.cos(r) - v.y * Math.sin(r), y: v.x * Math.sin(r) + v.y * Math.cos(r) };
}

// Rotation (degrees, clockwise from "handle straight up") that points from
// `center` at `pointer`; `snap` rounds to multiples of that many degrees.
export function rotationToward(center: Point, pointer: Point, snap?: number): number {
  let deg = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90;
  if (snap) deg = Math.round(deg / snap) * snap;
  return ((deg % 360) + 360) % 360;
}

// New frame when the corner at (sx, sy) ∈ {-1, 1}² is dragged to `pointer` while
// the opposite corner stays put in flow space. Works in the box's own
// (rotated) axes, so the result is the same with or without rotation.
export function resizeFromCorner(
  frame: { x: number; y: number; width: number; height: number },
  rotation: number,
  sx: number,
  sy: number,
  pointer: Point,
  minSize: number,
) {
  const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  const offset = rotate({ x: (-sx * frame.width) / 2, y: (-sy * frame.height) / 2 }, rotation);
  const anchor = { x: center.x + offset.x, y: center.y + offset.y };
  const local = rotate({ x: pointer.x - anchor.x, y: pointer.y - anchor.y }, -rotation);
  const width = Math.max(minSize, sx * local.x);
  const height = Math.max(minSize, sy * local.y);
  const half = rotate({ x: (sx * width) / 2, y: (sy * height) / 2 }, rotation);
  const newCenter = { x: anchor.x + half.x, y: anchor.y + half.y };
  return { position: { x: newCenter.x - width / 2, y: newCenter.y - height / 2 }, width, height };
}
