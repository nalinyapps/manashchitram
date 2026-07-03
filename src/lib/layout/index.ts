import type { Node, Edge } from "@xyflow/react";

export type LayoutMode =
  | "freeForm"
  | "fromParentFreeForm"
  | "horizontal"
  | "vertical"
  | "list"
  | "topDown"
  | "linear"
  | "radial"
  | "matrix";

export interface LayoutOptions {
  /** When set, only this node's subtree is arranged (the "From Parent" scope). */
  rootId?: string;
}

type Pos = { x: number; y: number };
type Positions = Record<string, Pos>;

// ── Spacing constants (flow units) ─────────────────────────────────────────
const DEFAULT_W = 180;
const DEFAULT_H = 80;
const H_GAP = 90;   // horizontal gap between siblings / columns
const V_GAP = 70;   // vertical gap between levels / rows

function sizeOf(node: Node): { w: number; h: number } {
  const w = (node.measured?.width  ?? (node.style?.width  as number) ?? DEFAULT_W) as number;
  const h = (node.measured?.height ?? (node.style?.height as number) ?? DEFAULT_H) as number;
  return { w, h };
}

// ── Graph helpers ──────────────────────────────────────────────────────────

interface Graph {
  children: Map<string, string[]>;
  parents: Map<string, string[]>;
  byId: Map<string, Node>;
}

function buildGraph(nodes: Node[], edges: Edge[]): Graph {
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  const byId = new Map<string, Node>();
  for (const n of nodes) {
    byId.set(n.id, n);
    if (!children.has(n.id)) children.set(n.id, []);
    if (!parents.has(n.id)) parents.set(n.id, []);
  }
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    children.get(e.source)!.push(e.target);
    parents.get(e.target)!.push(e.source);
  }
  return { children, parents, byId };
}

/** The set of node ids to arrange, plus the ordered roots. */
function resolveScope(graph: Graph, nodes: Node[], rootId?: string): { roots: string[]; inScope: Set<string> } {
  if (rootId && graph.byId.has(rootId)) {
    const inScope = new Set<string>();
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      if (inScope.has(id)) continue;
      inScope.add(id);
      for (const c of graph.children.get(id) ?? []) stack.push(c);
    }
    return { roots: [rootId], inScope };
  }
  // Whole board: roots are nodes with no parent; isolated nodes count as roots.
  const roots = nodes.filter((n) => (graph.parents.get(n.id) ?? []).length === 0).map((n) => n.id);
  return { roots: roots.length ? roots : nodes.map((n) => n.id), inScope: new Set(nodes.map((n) => n.id)) };
}

/** DFS order of a subtree, respecting the in-scope set and avoiding cycles. */
function dfsOrder(graph: Graph, root: string, inScope: Set<string>, seen: Set<string>): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    if (seen.has(id) || !inScope.has(id)) return;
    seen.add(id);
    out.push(id);
    for (const c of graph.children.get(id) ?? []) walk(c);
  };
  walk(root);
  return out;
}

// ── Tidy tree (used by topDown / horizontal / vertical) ─────────────────────
// Assigns a "primary" position along the growth axis by depth and packs the
// cross axis so subtrees don't overlap.

interface TidyResult { positions: Positions; extent: number }

function tidyTree(
  graph: Graph,
  root: string,
  inScope: Set<string>,
  seen: Set<string>,
  orientation: "vertical" | "horizontal"
): TidyResult {
  const positions: Positions = {};
  // cursor tracks the next free position on the cross axis
  let cursor = 0;

  const walk = (id: string, depth: number): { center: number } => {
    seen.add(id);
    const node = graph.byId.get(id)!;
    const { w, h } = sizeOf(node);
    const crossSize = orientation === "vertical" ? w : h;
    const mainSize = orientation === "vertical" ? h : w;
    const mainGap = mainSize + V_GAP;

    const kids = (graph.children.get(id) ?? []).filter((c) => inScope.has(c) && !seen.has(c));

    let center: number;
    if (kids.length === 0) {
      center = cursor + crossSize / 2;
      cursor += crossSize + H_GAP;
    } else {
      const childCenters = kids.map((c) => walk(c, depth + 1).center);
      center = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    }

    const main = depth * mainGap;
    if (orientation === "vertical") {
      positions[id] = { x: center - w / 2, y: main };
    } else {
      positions[id] = { x: main, y: center - h / 2 };
    }
    return { center };
  };

  walk(root, 0);
  return { positions, extent: cursor };
}

// ── Radial ──────────────────────────────────────────────────────────────────

function radialLayout(graph: Graph, root: string, inScope: Set<string>): Positions {
  const positions: Positions = {};
  const RING = 220;
  positions[root] = { x: 0, y: 0 };

  const place = (id: string, a0: number, a1: number, depth: number) => {
    const kids = (graph.children.get(id) ?? []).filter((c) => inScope.has(c));
    if (!kids.length) return;
    const span = a1 - a0;
    const step = span / kids.length;
    kids.forEach((c, i) => {
      const start = a0 + i * step;
      const end = start + step;
      const mid = (start + end) / 2;
      const r = RING * depth;
      positions[c] = { x: Math.cos(mid) * r, y: Math.sin(mid) * r };
      place(c, start, end, depth + 1);
    });
  };

  place(root, 0, Math.PI * 2, 1);
  return positions;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute new absolute positions for nodes under the given layout mode.
 * Returns a map of nodeId → {x, y}. Nodes not affected are omitted.
 */
export function computeLayout(
  nodes: Node[],
  edges: Edge[],
  mode: LayoutMode,
  options: LayoutOptions = {}
): Positions {
  if (mode === "freeForm") return {};

  const graph = buildGraph(nodes, edges);
  const { roots, inScope } = resolveScope(graph, nodes, options.rootId);
  const result: Positions = {};

  // Origin: anchor the arrangement near the first root's current position so
  // things don't jump to the far corner.
  const anchorNode = graph.byId.get(roots[0]);
  const originX = anchorNode?.position.x ?? 0;
  const originY = anchorNode?.position.y ?? 0;

  // Column offset used to separate multiple independent trees (whole-board scope).
  let columnOffset = 0;

  const applyOffset = (positions: Positions, dx: number, dy: number) => {
    for (const [id, p] of Object.entries(positions)) {
      result[id] = { x: p.x + dx, y: p.y + dy };
    }
  };

  if (mode === "matrix") {
    // Grid over all in-scope nodes, BFS-ordered from roots.
    const order: string[] = [];
    const seen = new Set<string>();
    const queue = [...roots];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id) || !inScope.has(id)) continue;
      seen.add(id);
      order.push(id);
      for (const c of graph.children.get(id) ?? []) queue.push(c);
    }
    for (const id of inScope) if (!seen.has(id)) order.push(id);
    const cols = Math.max(1, Math.ceil(Math.sqrt(order.length)));
    order.forEach((id, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      result[id] = { x: originX + c * (DEFAULT_W + H_GAP), y: originY + r * (DEFAULT_H + V_GAP) };
    });
    return result;
  }

  if (mode === "linear") {
    // Single horizontal chain in DFS order across all roots.
    const seen = new Set<string>();
    let i = 0;
    for (const root of roots) {
      for (const id of dfsOrder(graph, root, inScope, seen)) {
        result[id] = { x: originX + i * (DEFAULT_W + H_GAP), y: originY };
        i++;
      }
    }
    return result;
  }

  if (mode === "list") {
    // Indented outline: depth → x indent, running row → y.
    const seen = new Set<string>();
    let row = 0;
    const INDENT = 40;
    const walk = (id: string, depth: number) => {
      if (seen.has(id) || !inScope.has(id)) return;
      seen.add(id);
      result[id] = { x: originX + depth * INDENT, y: originY + row * (DEFAULT_H + 16) };
      row++;
      for (const c of graph.children.get(id) ?? []) walk(c, depth + 1);
    };
    for (const root of roots) walk(root, 0);
    return result;
  }

  if (mode === "radial" || mode === "fromParentFreeForm") {
    const seen = new Set<string>();
    for (const root of roots) {
      if (seen.has(root)) continue;
      const pos = radialLayout(graph, root, inScope);
      Object.keys(pos).forEach((id) => seen.add(id));
      const rootNode = graph.byId.get(root);
      applyOffset(pos, rootNode?.position.x ?? originX, rootNode?.position.y ?? originY);
    }
    return result;
  }

  // Tree layouts: topDown / vertical (both vertical orientation) and horizontal.
  const orientation: "vertical" | "horizontal" = mode === "horizontal" ? "horizontal" : "vertical";
  const seen = new Set<string>();
  for (const root of roots) {
    if (seen.has(root)) continue;
    const { positions, extent } = tidyTree(graph, root, inScope, seen, orientation);
    if (orientation === "vertical") {
      applyOffset(positions, originX + columnOffset, originY);
      columnOffset += extent + H_GAP * 2;
    } else {
      applyOffset(positions, originX, originY + columnOffset);
      columnOffset += extent + V_GAP * 2;
    }
  }
  return result;
}

// ── Metadata for the Layout panel ─────────────────────────────────────────────

export interface LayoutOption {
  mode: LayoutMode;
  label: string;
  description: string;
}

export const LAYOUT_OPTIONS: LayoutOption[] = [
  { mode: "fromParentFreeForm", label: "From Parent (Free Form)", description: "Radial spread from the selected node" },
  { mode: "freeForm",   label: "Free Form",        description: "Leave nodes where they are" },
  { mode: "horizontal", label: "Horizontal",       description: "Tree grows left to right" },
  { mode: "vertical",   label: "Vertical",         description: "Balanced tree fanning down" },
  { mode: "list",       label: "List",             description: "Indented outline" },
  { mode: "topDown",    label: "Top Down",         description: "Hierarchy from the top" },
  { mode: "linear",     label: "Linear",           description: "Single connected line" },
  { mode: "radial",     label: "Radial",           description: "Concentric rings by depth" },
  { mode: "matrix",     label: "Matrix",           description: "Even grid of all nodes" },
];
