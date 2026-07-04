"use client";

import { create } from "zustand";
import { MarkerType } from "@xyflow/react";
import type { Node, Edge, Viewport } from "@xyflow/react";
import type { BoardSettings, SaveStatus, VidyaBoard } from "@/lib/types";
import { DEFAULT_BOARD_SETTINGS } from "@/lib/types";
import { HISTORY_LIMIT } from "@/lib/config";
import { generateId } from "@/lib/utils";
import {
  computeLayout,
  routeForMode,
  assignDefaultHandles,
  resolveInsertedNodeCollisions,
  getNodeRect,
  type LayoutPlacement,
} from "@/lib/layout";
import { buildHierarchy, getSubtree } from "@/lib/layout/hierarchy";
import type { LayoutMode } from "@/lib/types";

interface HistoryEntry {
  nodes: Node[];
  edges: Edge[];
}

interface CanvasState {
  board: VidyaBoard | null;
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;
  settings: BoardSettings;
  selectedNodeIds: string[];
  saveStatus: SaveStatus;
  history: HistoryEntry[];
  historyIndex: number;
  clipboard: { nodes: Node[]; edges: Edge[] } | null;
  searchQuery: string;
  searchResults: string[];

  setBoard: (board: VidyaBoard) => void;
  setNodes: (nodes: Node[] | ((prev: Node[]) => Node[])) => void;
  setEdges: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void;
  setViewport: (viewport: Viewport) => void;
  setSettings: (settings: Partial<BoardSettings>) => void;
  setSaveStatus: (status: SaveStatus) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  setSearchQuery: (query: string) => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  copySelected: () => void;
  paste: () => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  createChildNode: (parentId: string) => void;
  createSiblingNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  convertNode: (nodeId: string, newType: string, extraData?: Record<string, unknown>) => void;
  updateBoardTitle: (title: string) => void;
  performSearch: (query: string) => void;
  applyLayout: (mode: LayoutMode) => void;
}

function cloneState(nodes: Node[], edges: Edge[]): HistoryEntry {
  return { nodes: structuredClone(nodes), edges: structuredClone(edges) };
}

function applyPlacements(nodes: Node[], placements: Record<string, LayoutPlacement>): Node[] {
  return nodes.map((n) => {
    const placement = placements[n.id];
    if (!placement) return n;
    const nextStyle = placement.width || placement.height
      ? { ...(n.style ?? {}), width: placement.width, height: placement.height }
      : n.style;
    return {
      ...n,
      position: { x: placement.x, y: placement.y },
      style: nextStyle,
    };
  });
}

function findLayoutRoot(nodeId: string, nodes: Node[], hierarchy: ReturnType<typeof buildHierarchy>): { id: string; mode?: LayoutMode } {
  let cur: string | null = nodeId;
  let fallback = nodeId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    fallback = cur;
    const node = nodes.find((n) => n.id === cur);
    const mode = (node?.data as { layoutMode?: LayoutMode } | undefined)?.layoutMode;
    if (mode) return { id: cur, mode };
    cur = hierarchy.get(cur)?.parentId ?? null;
  }
  return { id: fallback };
}

const BOARD_MATRIX_FRAME_KEY = "__board__";

function matrixFrameKey(rootId?: string): string {
  return rootId ?? BOARD_MATRIX_FRAME_KEY;
}

function autoMatrixFrameKey(node: Node): string | null {
  const data = node.data as { matrixFrameFor?: unknown } | undefined;
  return node.type === "frame" && typeof data?.matrixFrameFor === "string" ? data.matrixFrameFor : null;
}

function isAutoMatrixFrame(node: Node): boolean {
  return autoMatrixFrameKey(node) !== null;
}

function withMatrixFrame(nodes: Node[], scopeIds: Set<string>, key: string, enabled: boolean): Node[] {
  const withoutCurrentFrame = nodes.filter((n) => {
    const frameKey = autoMatrixFrameKey(n);
    if (!frameKey) return true;
    return key !== BOARD_MATRIX_FRAME_KEY && frameKey !== key;
  });

  if (!enabled) return withoutCurrentFrame;

  const scopedNodes = withoutCurrentFrame.filter((n) => scopeIds.has(n.id));
  if (!scopedNodes.length) return withoutCurrentFrame;

  const rects = scopedNodes.map(getNodeRect);
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  const pad = 6;
  const frame: Node = {
    id: `matrix-frame-${key}`,
    type: "frame",
    position: { x: minX - pad, y: minY - pad },
    data: {
      title: "",
      color: "#334155",
      background: "rgba(15, 23, 42, 0.015)",
      borderStyle: "solid",
      locked: true,
      matrixFrameFor: key,
      tags: [],
    },
    style: { width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 },
    zIndex: -10,
    selectable: false,
    draggable: false,
  };

  return [...withoutCurrentFrame, frame];
}

/**
 * Migrate legacy "mindmap" nodes into rounded shapes so every node is a
 * unified, connectable shape. Preserves all data; adds a shapeType default.
 */
function migrateNodes(nodes: Node[]): Node[] {
  return nodes.map((n) => {
    if (n.type !== "mindmap") return n;
    const data = n.data as Record<string, unknown>;
    return {
      ...n,
      type: "shape",
      data: { ...data, shapeType: (data.shapeType as string) ?? "rounded" },
    };
  });
}

/** Styling fields a child inherits from its parent (not content or per-node regions). */
function inheritStyle(parentData: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    "shapeType", "color", "fillColor", "fillOpacity",
    "borderColor", "borderWidth", "borderStyle", "borderRadius",
    "fontFamily", "fontSize", "textColor", "scriptMode",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (parentData[k] !== undefined) out[k] = parentData[k];
  return out;
}

/** Node types that can act as connectable mind-map shapes. Others default to shape. */
const CONNECTABLE_TYPES = new Set(["shape", "sticky", "text", "mindmap"]);

function childTypeFor(parentType: string | undefined): string {
  if (parentType && CONNECTABLE_TYPES.has(parentType)) {
    return parentType === "mindmap" ? "shape" : parentType;
  }
  return "shape";
}

function getNodeText(data: Record<string, unknown>): string {
  const fields = ["text", "title", "topic", "label", "devanagari", "iast", "translation", "rule"];
  return fields.map((f) => data[f]).filter(Boolean).join(" ");
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  board: null,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: { ...DEFAULT_BOARD_SETTINGS },
  selectedNodeIds: [],
  saveStatus: "saved",
  history: [],
  historyIndex: -1,
  clipboard: null,
  searchQuery: "",
  searchResults: [],

  setBoard: (board) => {
    const migrated = migrateNodes(board.content.nodes);
    // Infer + persist parentId from directed edges (for old boards).
    const hierarchy = buildHierarchy(migrated, board.content.edges);
    const nodes = migrated.map((n) => {
      const h = hierarchy.get(n.id);
      const existing = (n.data as { parentId?: string | null }).parentId;
      return { ...n, data: { ...n.data, parentId: existing ?? h?.parentId ?? null } };
    });
    // Ensure every edge has explicit handles so multi-handle nodes render cleanly.
    const edges = assignDefaultHandles(nodes, board.content.edges);
    set({
      board,
      nodes,
      edges,
      viewport: board.content.viewport ?? { x: 0, y: 0, zoom: 1 },
      settings: board.content.settings ?? DEFAULT_BOARD_SETTINGS,
      saveStatus: "saved",
      history: [],
      historyIndex: -1,
    });
  },

  setNodes: (nodesOrFn) =>
    set((state) => ({
      nodes: typeof nodesOrFn === "function" ? nodesOrFn(state.nodes) : nodesOrFn,
      saveStatus: "unsaved",
    })),

  setEdges: (edgesOrFn) =>
    set((state) => ({
      edges: typeof edgesOrFn === "function" ? edgesOrFn(state.edges) : edgesOrFn,
      saveStatus: "unsaved",
    })),

  setViewport: (viewport) => set({ viewport, saveStatus: "unsaved" }),

  setSettings: (partial) =>
    set((state) => ({
      settings: { ...state.settings, ...partial },
      saveStatus: "unsaved",
    })),

  setSaveStatus: (status) => set({ saveStatus: status }),

  setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  pushHistory: () => {
    const { nodes, edges, history, historyIndex } = get();
    const entry = cloneState(nodes, edges);
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(entry);
    if (newHistory.length > HISTORY_LIMIT) newHistory.shift();
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const entry = history[newIndex];
    set({
      nodes: structuredClone(entry.nodes),
      edges: structuredClone(entry.edges),
      historyIndex: newIndex,
      saveStatus: "unsaved",
    });
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    const entry = history[newIndex];
    set({
      nodes: structuredClone(entry.nodes),
      edges: structuredClone(entry.edges),
      historyIndex: newIndex,
      saveStatus: "unsaved",
    });
  },

  copySelected: () => {
    const { nodes, edges, selectedNodeIds } = get();
    if (!selectedNodeIds.length) return;
    const selectedNodes = nodes.filter((n) => selectedNodeIds.includes(n.id));
    const selectedEdges = edges.filter(
      (e) => selectedNodeIds.includes(e.source) && selectedNodeIds.includes(e.target)
    );
    set({ clipboard: { nodes: structuredClone(selectedNodes), edges: structuredClone(selectedEdges) } });
  },

  paste: () => {
    const { clipboard, nodes, edges } = get();
    if (!clipboard) return;
    get().pushHistory();
    const idMap = new Map<string, string>();
    const newNodes = clipboard.nodes.map((n) => {
      const newId = generateId();
      idMap.set(n.id, newId);
      return {
        ...structuredClone(n),
        id: newId,
        position: { x: n.position.x + 40, y: n.position.y + 40 },
        selected: true,
      };
    });
    const newEdges = clipboard.edges.map((e) => ({
      ...structuredClone(e),
      id: generateId(),
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
    }));
    set({
      nodes: [...nodes.map((n) => ({ ...n, selected: false })), ...newNodes],
      edges: [...edges, ...newEdges],
      selectedNodeIds: newNodes.map((n) => n.id),
      saveStatus: "unsaved",
    });
  },

  duplicateSelected: () => {
    get().copySelected();
    get().paste();
  },

  deleteSelected: () => {
    const { selectedNodeIds, nodes, edges } = get();
    if (!selectedNodeIds.length) return;
    get().pushHistory();
    set({
      nodes: nodes.filter((n) => !selectedNodeIds.includes(n.id)),
      edges: edges.filter(
        (e) => !selectedNodeIds.includes(e.source) && !selectedNodeIds.includes(e.target)
      ),
      selectedNodeIds: [],
      saveStatus: "unsaved",
    });
  },

  createChildNode: (parentId) => {
    const { nodes, edges } = get();
    const parent = nodes.find((n) => n.id === parentId);
    if (!parent) return;
    get().pushHistory();
    const childId = generateId();
    const childCount = edges.filter((e) => e.source === parentId).length;
    const parentData = parent.data as Record<string, unknown>;
    const childType = childTypeFor(parent.type);
    const mode = (parentData.layoutMode as LayoutMode) ?? "horizontal";
    const newNode: Node = {
      id: childId,
      type: childType,
      position: {
        x: parent.position.x + 240,
        y: parent.position.y + childCount * 90 - 40,
      },
      data: {
        ...inheritStyle(parentData),
        text: "New Idea",
        tags: [],
        parentId,
        ...(childType === "shape" && { shapeType: (parentData.shapeType as string) ?? "rounded" }),
      },
      style: parent.style ? { ...parent.style, height: undefined } : undefined,
    };
    const route = routeForMode(mode, parent, newNode);
    const hiddenInMatrix = mode === "matrix";
    const newEdge: Edge = {
      id: generateId(),
      source: parentId,
      target: childId,
      type: "branch",
      hidden: hiddenInMatrix,
      sourceHandle: route.sourceHandle,
      targetHandle: route.targetHandle,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" },
      data: { edgeType: "branch", curveStyle: route.curveStyle, hiddenInMatrix, layoutMode: mode },
    };
    // Record child in the parent's sibling order.
    const prevOrder = (parentData.childOrder as string[]) ?? [];
    const nextNodes = [
      ...nodes.map((n) =>
        n.id === parentId
          ? { ...n, data: { ...n.data, childOrder: [...prevOrder, childId] } }
          : n
      ),
      newNode,
    ];
    const nextEdges = [...edges, newEdge];
    const nextHierarchy = buildHierarchy(nextNodes, nextEdges);
    const layoutRoot = findLayoutRoot(parentId, nextNodes, nextHierarchy);
    const placements = layoutRoot.mode
      ? computeLayout(nextNodes, nextEdges, layoutRoot.mode, { rootId: layoutRoot.id })
      : resolveInsertedNodeCollisions(nextNodes, childId);
    const placedNodes = applyPlacements(nextNodes, placements);
    const finalNodes = layoutRoot.mode === "matrix"
      ? withMatrixFrame(placedNodes, new Set(getSubtree(layoutRoot.id, nextHierarchy)), matrixFrameKey(layoutRoot.id), true)
      : placedNodes;

    set({
      nodes: finalNodes,
      edges: nextEdges,
      selectedNodeIds: [childId],
      saveStatus: "unsaved",
    });
  },

  createSiblingNode: (nodeId) => {
    const { nodes, edges } = get();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const parentEdge = edges.find((e) => e.target === nodeId);
    get().pushHistory();
    const siblingId = generateId();
    const nodeData = node.data as Record<string, unknown>;
    const sibType = childTypeFor(node.type);
    const parentNode = parentEdge ? nodes.find((n) => n.id === parentEdge.source) : undefined;
    const mode = (parentNode?.data as Record<string, unknown> | undefined)?.layoutMode as LayoutMode | undefined;
    const newNode: Node = {
      id: siblingId,
      type: sibType,
      position: { x: node.position.x, y: node.position.y + 110 },
      data: {
        ...inheritStyle(nodeData),
        text: "New Idea",
        tags: [],
        parentId: parentEdge?.source ?? null,
        ...(sibType === "shape" && { shapeType: (nodeData.shapeType as string) ?? "rounded" }),
      },
      style: node.style ? { ...node.style, height: undefined } : undefined,
    };
    const newEdges = [...edges];
    if (parentEdge && parentNode) {
      const edgeMode = mode ?? "horizontal";
      const route = routeForMode(edgeMode, parentNode, newNode);
      const hiddenInMatrix = edgeMode === "matrix";
      newEdges.push({
        id: generateId(),
        source: parentEdge.source,
        target: siblingId,
        type: "branch",
        hidden: hiddenInMatrix,
        sourceHandle: route.sourceHandle,
        targetHandle: route.targetHandle,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" },
        data: { edgeType: "branch", curveStyle: route.curveStyle, hiddenInMatrix, layoutMode: edgeMode },
      });
    }
    const nextNodes = [...nodes, newNode];
    const nextHierarchy = buildHierarchy(nextNodes, newEdges);
    const layoutRoot = findLayoutRoot(parentEdge?.source ?? nodeId, nextNodes, nextHierarchy);
    const placements = layoutRoot.mode
      ? computeLayout(nextNodes, newEdges, layoutRoot.mode, { rootId: layoutRoot.id })
      : resolveInsertedNodeCollisions(nextNodes, siblingId);
    const placedNodes = applyPlacements(nextNodes, placements);
    const finalNodes = layoutRoot.mode === "matrix"
      ? withMatrixFrame(placedNodes, new Set(getSubtree(layoutRoot.id, nextHierarchy)), matrixFrameKey(layoutRoot.id), true)
      : placedNodes;

    set({
      nodes: finalNodes,
      edges: newEdges,
      selectedNodeIds: [siblingId],
      saveStatus: "unsaved",
    });
  },

  updateNodeData: (nodeId, data) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      ),
      saveStatus: "unsaved",
    }));
  },

  convertNode: (nodeId, newType, extraData = {}) => {
    const { nodes } = get();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    get().pushHistory();

    const newData = { ...node.data, ...extraData };
    if (newType === "shape" && !newData.shapeType) newData.shapeType = "rounded";
    if (newType === "mindmap" && !newData.color)   newData.color = "#818cf8";
    if (newType === "sticky"  && !newData.color)   newData.color = "yellow";

    // Resize to fit text when switching to shapes that need more room
    const curW = (node.measured?.width  ?? (node.style?.width  as number) ?? 180) as number;
    const curH = (node.measured?.height ?? (node.style?.height as number) ?? 80)  as number;
    const shapeType = (newData.shapeType as string) ?? "";
    let newStyle = { ...node.style };
    if (shapeType === "diamond")  { newStyle = { ...newStyle, width: Math.max(curW * 1.5, 180), height: Math.max(curH * 1.5, 120) }; }
    if (shapeType === "circle")   { const s = Math.max(curW, curH, 100); newStyle = { ...newStyle, width: s, height: s }; }
    if (shapeType === "triangle") { newStyle = { ...newStyle, width: Math.max(curW * 1.3, 160), height: Math.max(curH * 1.3, 100) }; }
    // Ensure a minimum size for shapes
    if (newType === "shape" && !newStyle.height) newStyle = { ...newStyle, height: Math.max(curH, 80) };

    set({
      nodes: nodes.map((n) => n.id === nodeId ? { ...n, type: newType, data: newData, style: newStyle } : n),
      saveStatus: "unsaved",
    });
  },

  applyLayout: (mode) => {
    const { nodes, edges, selectedNodeIds } = get();
    if (!nodes.length) return;
    const layoutNodes = nodes.filter((n) => !isAutoMatrixFrame(n));
    const selectedRootId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : undefined;
    const rootId = selectedRootId && layoutNodes.some((n) => n.id === selectedRootId) ? selectedRootId : undefined;

    const hierarchy = buildHierarchy(layoutNodes, edges);
    const positions = computeLayout(layoutNodes, edges, mode, { rootId });

    // Nodes in scope: the selected subtree, or the whole board when nothing selected.
    const scopeIds = rootId
      ? new Set(getSubtree(rootId, hierarchy))
      : new Set(layoutNodes.map((n) => n.id));

    get().pushHistory();

    const byId = new Map(layoutNodes.map((n) => [n.id, n]));

    // Reroute parent→child edges within scope, using post-layout geometry.
    const newEdges = edges.map((e) => {
      const touchesScope = scopeIds.has(e.source) || scopeIds.has(e.target);
      const insideScope = scopeIds.has(e.source) && scopeIds.has(e.target);
      if (!touchesScope) return e;
      if (!insideScope) {
        const hiddenInMatrix = mode === "matrix";
        return {
          ...e,
          hidden: hiddenInMatrix,
          data: { ...(e.data ?? {}), hiddenInMatrix, layoutMode: mode },
        };
      }
      const parent = byId.get(e.source);
      const child = byId.get(e.target);
      if (!parent || !child) return e;
      const pParent = positions[e.source] ? { ...parent, position: positions[e.source] } : parent;
      const pChild = positions[e.target] ? { ...child, position: positions[e.target] } : child;
      const route = routeForMode(mode, pParent, pChild);
      const hiddenInMatrix = mode === "matrix";
      return {
        ...e,
        hidden: hiddenInMatrix,
        sourceHandle: route.sourceHandle,
        targetHandle: route.targetHandle,
        markerEnd: e.markerEnd ?? { type: MarkerType.ArrowClosed, color: "#6366f1" },
        data: { ...(e.data ?? {}), edgeType: "branch", curveStyle: route.curveStyle, hiddenInMatrix, layoutMode: mode },
      };
    });

    // Apply positions + persist hierarchy metadata for in-scope nodes.
    const laidOutNodes = layoutNodes.map((n) => {
      const inScope = scopeIds.has(n.id);
      const pos = positions[n.id];
      let data = n.data as Record<string, unknown>;
      if (inScope) {
        const h = hierarchy.get(n.id);
        data = { ...data, parentId: h?.parentId ?? null, childOrder: h?.childIds ?? [] };
        if (n.id === rootId) data.layoutMode = mode;
      }
      const style = pos?.width || pos?.height
        ? { ...(n.style ?? {}), width: pos.width, height: pos.height }
        : n.style;
      return { ...n, ...(pos ? { position: { x: pos.x, y: pos.y } } : {}), style, data };
    });
    const existingMatrixFrames = nodes.filter(isAutoMatrixFrame);
    const frameKey = matrixFrameKey(rootId);
    const newNodes = withMatrixFrame(
      [...laidOutNodes, ...existingMatrixFrames],
      scopeIds,
      frameKey,
      mode === "matrix"
    );

    set({ nodes: newNodes, edges: newEdges, saveStatus: "unsaved" });
  },

  updateBoardTitle: (title) =>
    set((state) => ({
      board: state.board ? { ...state.board, title } : null,
      saveStatus: "unsaved",
    })),

  performSearch: (query) => {
    const { nodes, edges } = get();
    if (!query.trim()) {
      set({ searchResults: [], searchQuery: query });
      return;
    }
    const q = query.toLowerCase();
    const results: string[] = [];
    for (const node of nodes) {
      const text = getNodeText(node.data as Record<string, unknown>);
      const tags = ((node.data as { tags?: string[] }).tags ?? []).join(" ");
      if (text.toLowerCase().includes(q) || tags.toLowerCase().includes(q)) {
        results.push(node.id);
      }
    }
    for (const edge of edges) {
      const label = String((edge.data as { label?: string })?.label ?? "");
      if (label.toLowerCase().includes(q)) {
        results.push(edge.id);
      }
    }
    set({ searchResults: results, searchQuery: query });
  },
}));
