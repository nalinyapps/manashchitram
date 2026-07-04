import type { Node, Edge } from "@xyflow/react";
import type { LayoutMode } from "@/lib/types";
import { buildHierarchy, getSubtree, getRoots, type Hierarchy } from "./hierarchy";

export type { LayoutMode };

export interface LayoutOptions {
  /** When set, only this node's subtree is arranged; the root stays fixed. */
  rootId?: string;
}

type Pos = { x: number; y: number };
export type LayoutPlacement = Pos & { width?: number; height?: number };
type Positions = Record<string, LayoutPlacement>;
type Side = "top" | "right" | "bottom" | "left";

// -- Spacing constants (generous by design - clarity over compactness) --------
const MIN_NODE_PADDING_X = 80;
const MIN_NODE_PADDING_Y = 48;
const LEVEL_GAP_X = 260;
const LEVEL_GAP_Y = 170;
const LIST_ROW_GAP = 24;
const LIST_DEPTH_INDENT = 180;
const LIST_SECTION_GAP = 40;
const RADIAL_LEVEL_GAP = 280;
const LINEAR_GAP = 120;

// Matrix constants
const MATRIX_MIN_COL_WIDTH = 180;
const MATRIX_CATEGORY_COL_WIDTH = 260;
const MATRIX_DETAIL_MIN_WIDTH = 520;
const MATRIX_MIN_ROW_HEIGHT = 72;
const MATRIX_HEADER_GAP = 56;
const MATRIX_CELL_PAD_X = 28;
const MATRIX_CELL_PAD_Y = 20;
const MATRIX_CELL_GAP_X = 8;
const MATRIX_CELL_GAP_Y = 8;
const MATRIX_SECTION_GAP_Y = 36;
const MATRIX_HEADER_HEIGHT = 64;

const DEFAULT_W = 180;
const DEFAULT_H = 80;

// -- Rect / size helpers ------------------------------------------------------

export interface NodeRect { id: string; x: number; y: number; width: number; height: number }

function dimension(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function sizeOf(node: Node): { w: number; h: number } {
  const w = dimension(node.measured?.width ?? node.style?.width, DEFAULT_W);
  const h = dimension(node.measured?.height ?? node.style?.height, DEFAULT_H);
  return { w, h };
}

export function getNodeRect(node: Node): NodeRect {
  const { w, h } = sizeOf(node);
  return { id: node.id, x: node.position.x, y: node.position.y, width: w, height: h };
}

export function rectsOverlap(a: NodeRect, b: NodeRect, pad = 0): boolean {
  return (
    a.x - pad < b.x + b.width &&
    a.x + a.width + pad > b.x &&
    a.y - pad < b.y + b.height &&
    a.y + a.height + pad > b.y
  );
}

function rectsTooClose(a: NodeRect, b: NodeRect, padX: number, padY: number): boolean {
  return (
    a.x - padX < b.x + b.width &&
    a.x + a.width + padX > b.x &&
    a.y - padY < b.y + b.height &&
    a.y + a.height + padY > b.y
  );
}

function centerOf(node: Node): Pos {
  const { w, h } = sizeOf(node);
  return { x: node.position.x + w / 2, y: node.position.y + h / 2 };
}

// -- Collision resolution (structure-preserving, axis-constrained) ------------
// Pushes overlapping nodes apart along a single axis so the layout's primary
// structure (rows/columns) is preserved.

function resolveCollisions(
  positions: Positions,
  byId: Map<string, Node>,
  axis: "x" | "y",
  padX = MIN_NODE_PADDING_X,
  padY = MIN_NODE_PADDING_Y,
  iterations = 8
): void {
  const ids = Object.keys(positions);
  const rect = (id: string): NodeRect => {
    const { w, h } = sizeOf(byId.get(id)!);
    return { id, x: positions[id].x, y: positions[id].y, width: w, height: h };
  };
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = rect(ids[i]);
        const b = rect(ids[j]);
        if (!rectsTooClose(a, b, padX, padY)) continue;
        if (axis === "y") {
          const overlap = Math.min(a.y + a.height + padY, b.y + b.height + padY) - Math.max(a.y, b.y);
          const lower = a.y <= b.y ? ids[j] : ids[i];
          positions[lower].y += overlap;
        } else {
          const overlap = Math.min(a.x + a.width + padX, b.x + b.width + padX) - Math.max(a.x, b.x);
          const right = a.x <= b.x ? ids[j] : ids[i];
          positions[right].x += overlap;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}

export function resolveInsertedNodeCollisions(
  nodes: Node[],
  insertedId: string,
  padX = MIN_NODE_PADDING_X,
  padY = MIN_NODE_PADDING_Y
): Positions {
  const inserted = nodes.find((n) => n.id === insertedId);
  if (!inserted) return {};

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const positions: Positions = {};
  for (const n of nodes) positions[n.id] = { ...n.position };

  const rect = (id: string): NodeRect => {
    const n = byId.get(id)!;
    const { w, h } = sizeOf(n);
    return { id, x: positions[id].x, y: positions[id].y, width: w, height: h };
  };

  for (let iteration = 0; iteration < 10; iteration++) {
    let moved = false;
    const anchor = rect(insertedId);
    for (const node of nodes) {
      if (node.id === insertedId) continue;
      const other = rect(node.id);
      if (!rectsTooClose(anchor, other, padX, padY)) continue;
      const pushBelow = other.y + other.height / 2 >= anchor.y + anchor.height / 2;
      if (pushBelow) {
        positions[node.id].y = Math.max(positions[node.id].y, anchor.y + anchor.height + padY);
      } else {
        positions[node.id].y = Math.min(positions[node.id].y, anchor.y - other.height - padY);
      }
      moved = true;
    }
    resolveCollisions(positions, byId, "y", padX, padY, 3);
    if (!moved) break;
  }

  const changed: Positions = {};
  for (const n of nodes) {
    const p = positions[n.id];
    if (p.x !== n.position.x || p.y !== n.position.y) changed[n.id] = p;
  }
  return changed;
}

// -- Tidy tree with adaptive, content-aware level spacing ---------------------
// - Cross axis: leaf cursor packs siblings using real node sizes (no overlap).
// - Main axis: each depth band is offset by the tallest/widest node at that
//   depth + a generous level gap (prevents cross-depth overlap for tall nodes).

function tidyTree(
  rootId: string,
  hierarchy: Hierarchy,
  byId: Map<string, Node>,
  axis: "v" | "h"
): Positions {
  const depthMaxMain = new Map<number, number>();
  const collect = (id: string, depth: number) => {
    const { w, h } = sizeOf(byId.get(id)!);
    const main = axis === "v" ? h : w;
    depthMaxMain.set(depth, Math.max(depthMaxMain.get(depth) ?? 0, main));
    for (const c of hierarchy.get(id)?.childIds ?? []) collect(c, depth + 1);
  };
  collect(rootId, 0);

  const levelGap = axis === "v" ? LEVEL_GAP_Y : LEVEL_GAP_X;
  const maxDepth = Math.max(...depthMaxMain.keys());
  const levelCenter = new Map<number, number>();
  let acc = 0;
  for (let d = 0; d <= maxDepth; d++) {
    const band = depthMaxMain.get(d) ?? (axis === "v" ? DEFAULT_H : DEFAULT_W);
    levelCenter.set(d, acc + band / 2);
    acc += band + levelGap;
  }

  const crossGap = axis === "v" ? MIN_NODE_PADDING_X : MIN_NODE_PADDING_Y;
  const centers: Positions = {};
  let cursor = 0;

  const walk = (id: string, depth: number): number => {
    const { w, h } = sizeOf(byId.get(id)!);
    const crossSize = axis === "v" ? w : h;
    const kids = hierarchy.get(id)?.childIds ?? [];
    let cross: number;
    if (kids.length === 0) {
      cross = cursor + crossSize / 2;
      cursor += crossSize + crossGap;
    } else {
      const cc = kids.map((c) => walk(c, depth + 1));
      cross = (cc[0] + cc[cc.length - 1]) / 2;
    }
    const main = levelCenter.get(depth)!;
    centers[id] = axis === "v" ? { x: cross, y: main } : { x: main, y: cross };
    return cross;
  };
  walk(rootId, 0);
  return centers;
}

// -- Radial with per-depth radius sized to fit all nodes on the ring ----------

function radialTree(rootId: string, hierarchy: Hierarchy, byId: Map<string, Node>): Positions {
  const centers: Positions = { [rootId]: { x: 0, y: 0 } };

  // Leaf counts drive angular allocation.
  const leaves = new Map<string, number>();
  const calcLeaves = (id: string): number => {
    const kids = hierarchy.get(id)?.childIds ?? [];
    if (!kids.length) { leaves.set(id, 1); return 1; }
    let s = 0;
    for (const c of kids) s += calcLeaves(c);
    leaves.set(id, s);
    return s;
  };
  calcLeaves(rootId);

  // Nodes + max node size per depth -> radius large enough to avoid overlap.
  const depthNodes = new Map<number, string[]>();
  const collect = (id: string, depth: number) => {
    if (!depthNodes.has(depth)) depthNodes.set(depth, []);
    depthNodes.get(depth)!.push(id);
    for (const c of hierarchy.get(id)?.childIds ?? []) collect(c, depth + 1);
  };
  collect(rootId, 0);

  const radiusAt = new Map<number, number>();
  radiusAt.set(0, 0);
  const maxDepth = Math.max(...depthNodes.keys());
  for (let d = 1; d <= maxDepth; d++) {
    const ids = depthNodes.get(d) ?? [];
    const maxCross = Math.max(...ids.map((id) => sizeOf(byId.get(id)!).w), DEFAULT_W);
    // Circumference must fit all nodes with padding.
    const needed = (ids.length * (maxCross + MIN_NODE_PADDING_X)) / (2 * Math.PI);
    radiusAt.set(d, Math.max(d * RADIAL_LEVEL_GAP, needed, (radiusAt.get(d - 1) ?? 0) + RADIAL_LEVEL_GAP));
  }

  const place = (id: string, a0: number, a1: number, depth: number) => {
    const kids = hierarchy.get(id)?.childIds ?? [];
    if (!kids.length) return;
    const total = leaves.get(id) ?? kids.length;
    let a = a0;
    for (const c of kids) {
      const frac = (leaves.get(c) ?? 1) / total;
      const start = a;
      const end = a + (a1 - a0) * frac;
      const mid = (start + end) / 2;
      const r = radiusAt.get(depth) ?? depth * RADIAL_LEVEL_GAP;
      centers[c] = { x: Math.cos(mid) * r, y: Math.sin(mid) * r };
      place(c, start, end, depth + 1);
      a = end;
    }
  };
  place(rootId, -Math.PI / 2, Math.PI * 1.5, 1);
  return centers;
}

// -- Center coords -> top-left, anchored so the root stays fixed ---------------

function centersToPositions(centers: Positions, rootId: string, byId: Map<string, Node>): Positions {
  const rootNode = byId.get(rootId)!;
  const rootCenter = centerOf(rootNode);
  const rc = centers[rootId] ?? { x: 0, y: 0 };
  const out: Positions = {};
  for (const [id, c] of Object.entries(centers)) {
    const { w, h } = sizeOf(byId.get(id)!);
    out[id] = {
      x: rootCenter.x + (c.x - rc.x) - w / 2,
      y: rootCenter.y + (c.y - rc.y) - h / 2,
    };
  }
  return out;
}

// -- Matrix: hierarchy-aware chart / table ------------------------------------

function matrixLayout(rootId: string, hierarchy: Hierarchy, byId: Map<string, Node>): Positions {
  const out: Positions = {};
  const rootNode = byId.get(rootId)!;
  const rootCenter = centerOf(rootNode);
  const startY = rootNode.position.y;
  const rootSize = sizeOf(rootNode);

  const categories = hierarchy.get(rootId)?.childIds ?? [];
  const hasGrandchildren = categories.some((c) => (hierarchy.get(c)?.childIds ?? []).length > 0);

  // Header (root) stays put.
  out[rootId] = { x: rootNode.position.x, y: startY };
  const tableTop = startY + MATRIX_HEADER_HEIGHT + MATRIX_HEADER_GAP;

  if (!hasGrandchildren) {
    // -- Section grid: root header + a balanced grid of its direct children --
    const kids = categories;
    if (!kids.length) return out;
    const cols = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(kids.length * 1.4))));
    const cellW = Math.max(MATRIX_MIN_COL_WIDTH, ...kids.map((id) => sizeOf(byId.get(id)!).w)) + MATRIX_CELL_PAD_X;
    const cellH = Math.max(MATRIX_MIN_ROW_HEIGHT, ...kids.map((id) => sizeOf(byId.get(id)!).h)) + MATRIX_CELL_PAD_Y;
    const gridWidth = cols * cellW + (cols - 1) * MATRIX_CELL_GAP_X;
    const startX = rootCenter.x - gridWidth / 2;
    out[rootId] = { x: startX, y: startY, width: Math.max(gridWidth, rootSize.w), height: MATRIX_HEADER_HEIGHT };
    kids.forEach((id, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      out[id] = {
        x: startX + c * (cellW + MATRIX_CELL_GAP_X),
        y: tableTop + r * (cellH + MATRIX_CELL_GAP_Y),
        width: cellW,
        height: cellH,
      };
    });
    return out;
  }

  // -- Full table: rows = (category, subitem, details...) --
  interface Row { category: string; subitem: string | null; details: string[] }
  const flattenDetails = (id: string): string[] => {
    const out: string[] = [];
    const walk = (cur: string) => {
      for (const child of hierarchy.get(cur)?.childIds ?? []) {
        out.push(child);
        walk(child);
      }
    };
    walk(id);
    return out;
  };
  const rows: Row[] = [];
  for (const cat of categories) {
    const subitems = hierarchy.get(cat)?.childIds ?? [];
    if (!subitems.length) {
      rows.push({ category: cat, subitem: null, details: [] });
    } else {
      subitems.forEach((sub) => {
        rows.push({ category: cat, subitem: sub, details: flattenDetails(sub) });
      });
    }
  }

  // Column widths from widest node in each role.
  let categoryW = MATRIX_CATEGORY_COL_WIDTH;
  let subitemW = MATRIX_MIN_COL_WIDTH;
  let detailW = MATRIX_DETAIL_MIN_WIDTH;
  for (const r of rows) {
    categoryW = Math.max(categoryW, sizeOf(byId.get(r.category)!).w + MATRIX_CELL_PAD_X);
    if (r.subitem) subitemW = Math.max(subitemW, sizeOf(byId.get(r.subitem)!).w + MATRIX_CELL_PAD_X);
    for (const d of r.details) detailW = Math.max(detailW, sizeOf(byId.get(d)!).w + MATRIX_CELL_PAD_X);
  }
  const tableWidth = categoryW + subitemW + detailW + MATRIX_CELL_GAP_X * 2;
  const tableStartX = rootCenter.x - tableWidth / 2;
  const categoryX = tableStartX;
  const subitemX = categoryX + categoryW + MATRIX_CELL_GAP_X;
  const detailX = subitemX + subitemW + MATRIX_CELL_GAP_X;

  out[rootId] = { x: tableStartX, y: startY, width: Math.max(tableWidth, rootSize.w), height: MATRIX_HEADER_HEIGHT };

  // Row heights from tallest node in each row.
  const categoryCounts = rows.reduce((map, row) => {
    map.set(row.category, (map.get(row.category) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  const rowHeight = rows.map((r) => {
    const detailStackH = r.details.length
      ? r.details.reduce((sum, id) => sum + sizeOf(byId.get(id)!).h, 0) +
        Math.max(0, r.details.length - 1) * MATRIX_CELL_GAP_Y +
        MATRIX_CELL_PAD_Y
      : 0;
    const subitemH = r.subitem ? sizeOf(byId.get(r.subitem)!).h + MATRIX_CELL_PAD_Y : 0;
    const categoryH = categoryCounts.get(r.category) === 1 ? sizeOf(byId.get(r.category)!).h + MATRIX_CELL_PAD_Y : 0;
    return Math.max(MATRIX_MIN_ROW_HEIGHT, detailStackH, subitemH, categoryH);
  });

  // Lay rows top-to-bottom; add a section gap when the category changes.
  let y = tableTop;
  let prevCat: string | null = null;
  const catRowSpan = new Map<string, { top: number; bottom: number }>();
  rows.forEach((r, i) => {
    if (prevCat !== null && r.category !== prevCat) y += MATRIX_SECTION_GAP_Y;
    const rh = rowHeight[i];
    if (r.subitem) out[r.subitem] = { x: subitemX, y, width: subitemW, height: rh };
    let detailY = y;
    r.details.forEach((d) => {
      const naturalH = sizeOf(byId.get(d)!).h + MATRIX_CELL_PAD_Y;
      const detailH = r.details.length === 1 ? rh : naturalH;
      out[d] = {
        x: detailX,
        y: detailY,
        width: detailW,
        height: detailH,
      };
      detailY += detailH + MATRIX_CELL_GAP_Y;
    });
    const span = catRowSpan.get(r.category) ?? { top: y, bottom: y + rh };
    span.top = Math.min(span.top, y);
    span.bottom = Math.max(span.bottom, y + rh);
    catRowSpan.set(r.category, span);
    y += rh + MATRIX_CELL_GAP_Y;
    prevCat = r.category;
  });

  // Category labels centered vertically over their row span, in column 0.
  for (const [cat, span] of catRowSpan) {
    out[cat] = {
      x: categoryX,
      y: span.top,
      width: categoryW,
      height: span.bottom - span.top,
    };
  }

  return out;
}

// -- Public: compute positions ------------------------------------------------

export function computeLayout(
  nodes: Node[],
  edges: Edge[],
  mode: LayoutMode,
  options: LayoutOptions = {}
): Positions {
  if (mode === "freeForm") return {};
  if (!nodes.length) return {};

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hierarchy = buildHierarchy(nodes, edges);
  const roots = options.rootId && byId.has(options.rootId) ? [options.rootId] : getRoots(hierarchy);
  if (!roots.length) return {};

  const result: Positions = {};

  for (const root of roots) {
    const subtree = getSubtree(root, hierarchy);
    const lone = subtree.length === 1;
    const rootNode = byId.get(root)!;
    const rootCenter = centerOf(rootNode);

    if (mode === "horizontal" || mode === "vertical" || mode === "topDown") {
      if (lone) continue;
      const centers = tidyTree(root, hierarchy, byId, mode === "horizontal" ? "h" : "v");
      const pos = centersToPositions(centers, root, byId);
      // Safety: resolve residual overlaps along the cross axis (keep root fixed).
      resolveCollisions(pos, byId, mode === "horizontal" ? "y" : "x");
      Object.assign(result, pos);
    } else if (mode === "radial" || mode === "fromParentFreeForm") {
      if (lone) continue;
      const centers = radialTree(root, hierarchy, byId);
      const pos = centersToPositions(centers, root, byId);
      resolveCollisions(pos, byId, "y");
      Object.assign(result, pos);
    } else if (mode === "list") {
      let y = rootNode.position.y;
      let prevDepth1: string | null = null;
      const seen = new Set<string>();
      const walk = (id: string, depth: number) => {
        if (seen.has(id)) return;
        seen.add(id);
        const { h } = sizeOf(byId.get(id)!);
        if (depth === 1 && prevDepth1 !== null) y += LIST_SECTION_GAP;
        result[id] = { x: rootNode.position.x + depth * LIST_DEPTH_INDENT, y };
        y += h + LIST_ROW_GAP;
        if (depth === 1) prevDepth1 = id;
        for (const c of hierarchy.get(id)?.childIds ?? []) walk(c, depth + 1);
      };
      walk(root, 0);
      resolveCollisions(result, byId, "y", MIN_NODE_PADDING_X, LIST_ROW_GAP);
    } else if (mode === "linear") {
      const order = getSubtree(root, hierarchy);
      let x = rootNode.position.x;
      for (const id of order) {
        const { w, h } = sizeOf(byId.get(id)!);
        result[id] = { x, y: rootCenter.y - h / 2 };
        x += w + LINEAR_GAP;
      }
      resolveCollisions(result, byId, "x");
    } else if (mode === "matrix") {
      const pos = matrixLayout(root, hierarchy, byId);
      resolveCollisions(pos, byId, "y", MATRIX_CELL_PAD_X, MATRIX_CELL_PAD_Y);
      Object.assign(result, pos);
    }
  }

  return result;
}

// -- Layout-aware edge routing metadata ---------------------------------------

export interface EdgeRoute {
  sourceHandle: Side;
  targetHandle: Side;
  curveStyle: "smooth" | "step" | "straight";
}

function opposite(side: Side): Side {
  return side === "top" ? "bottom" : side === "bottom" ? "top" : side === "left" ? "right" : "left";
}

function nearestSides(a: Node, b: Node): { source: Side; target: Side } {
  const ca = centerOf(a);
  const cb = centerOf(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const source: Side = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : (dy >= 0 ? "bottom" : "top");
  return { source, target: opposite(source) };
}

export function routeForMode(mode: LayoutMode, parent: Node, child: Node): EdgeRoute {
  switch (mode) {
    case "horizontal":
      return { sourceHandle: "right", targetHandle: "left", curveStyle: "step" };
    case "vertical":
    case "topDown":
      return { sourceHandle: "bottom", targetHandle: "top", curveStyle: "step" };
    case "list":
      return { sourceHandle: "bottom", targetHandle: "left", curveStyle: "step" };
    case "matrix": {
      const { source, target } = nearestSides(parent, child);
      return { sourceHandle: source, targetHandle: target, curveStyle: "step" };
    }
    case "linear": {
      const { source, target } = nearestSides(parent, child);
      return { sourceHandle: source, targetHandle: target, curveStyle: "step" };
    }
    case "radial":
    case "fromParentFreeForm":
    case "freeForm":
    default: {
      const { source, target } = nearestSides(parent, child);
      return { sourceHandle: source, targetHandle: target, curveStyle: "smooth" };
    }
  }
}

export function assignDefaultHandles(nodes: Node[], edges: Edge[]): Edge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let changed = false;
  const next = edges.map((e) => {
    if (e.sourceHandle && e.targetHandle) return e;
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) return e;
    const { source, target } = nearestSides(s, t);
    changed = true;
    return { ...e, sourceHandle: e.sourceHandle ?? source, targetHandle: e.targetHandle ?? target };
  });
  return changed ? next : edges;
}

// -- Panel metadata ------------------------------------------------------------

export interface LayoutOption { mode: LayoutMode; label: string; description: string }

export const LAYOUT_OPTIONS: LayoutOption[] = [
  { mode: "fromParentFreeForm", label: "From Parent (Free Form)", description: "Radial spread from the selected node" },
  { mode: "freeForm",   label: "Free Form",  description: "Leave nodes where they are" },
  { mode: "horizontal", label: "Horizontal", description: "Tree grows left to right" },
  { mode: "vertical",   label: "Vertical",   description: "Balanced tree fanning down" },
  { mode: "list",       label: "List",       description: "Indented outline" },
  { mode: "topDown",    label: "Top Down",   description: "Hierarchy from the top" },
  { mode: "linear",     label: "Linear",     description: "Single connected line" },
  { mode: "radial",     label: "Radial",     description: "Concentric rings by depth" },
  { mode: "matrix",     label: "Matrix",     description: "Structured chart / table" },
];
