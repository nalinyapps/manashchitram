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
  rectsOverlap,
  sizeOf,
  type LayoutPlacement,
} from "@/lib/layout";
import { buildHierarchy, getSubtree } from "@/lib/layout/hierarchy";
import type { LayoutMode } from "@/lib/types";

interface HistoryEntry {
  nodes: Node[];
  edges: Edge[];
}

type ContentSize = { width: number; height: number; lineCount?: number; lineHeight?: number };

interface CanvasState {
  board: VidyaBoard | null;
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;
  settings: BoardSettings;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
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
  setSelectedEdgeIds: (ids: string[]) => void;
  setSearchQuery: (query: string) => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  copySelected: () => void;
  paste: () => void;
  duplicateNode: (nodeId: string) => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  deleteEdges: (ids: string[]) => void;
  createChildNode: (parentId: string) => void;
  createSiblingNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  fitNodeToContent: (nodeId: string, contentSize: ContentSize) => void;
  resizeNodeToFitBounds: (nodeId: string, bounds: { width: number; height: number }) => void;
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
const BOARD_SUNBURST_KEY = "__board__";

function matrixFrameKey(rootId?: string): string {
  return rootId ?? BOARD_MATRIX_FRAME_KEY;
}

function sunburstFrameKey(rootId?: string): string {
  return rootId ?? BOARD_SUNBURST_KEY;
}

function autoMatrixFrameKey(node: Node): string | null {
  const data = node.data as { matrixFrameFor?: unknown } | undefined;
  return node.type === "frame" && typeof data?.matrixFrameFor === "string" ? data.matrixFrameFor : null;
}

function isAutoMatrixFrame(node: Node): boolean {
  return autoMatrixFrameKey(node) !== null;
}

function autoSunburstKey(node: Node): string | null {
  const data = node.data as { sunburstFor?: unknown } | undefined;
  return node.type === "sunburst" && typeof data?.sunburstFor === "string" ? data.sunburstFor : null;
}

function isAutoSunburstNode(node: Node): boolean {
  return autoSunburstKey(node) !== null;
}

function clearSunburstNodes(nodes: Node[]): Node[] {
  return nodes
    .filter((node) => !isAutoSunburstNode(node))
    .map((node) => {
      const data = (node.data ?? {}) as Record<string, unknown>;
      if (!data.sunburstHiddenFor) return node;
      const { sunburstHiddenFor: _sunburstHiddenFor, ...nextData } = data;
      void _sunburstHiddenFor;
      return { ...node, hidden: false, data: nextData };
    });
}

function sunburstTreeStats(rootId: string, hierarchy: ReturnType<typeof buildHierarchy>): { maxDepth: number; leaves: number } {
  const walk = (id: string, depth: number): { maxDepth: number; leaves: number } => {
    const childIds = hierarchy.get(id)?.childIds ?? [];
    if (!childIds.length) return { maxDepth: depth, leaves: 1 };
    return childIds.reduce(
      (stats, childId) => {
        const childStats = walk(childId, depth + 1);
        return {
          maxDepth: Math.max(stats.maxDepth, childStats.maxDepth),
          leaves: stats.leaves + childStats.leaves,
        };
      },
      { maxDepth: depth, leaves: 0 }
    );
  };
  return walk(rootId, 0);
}

function sunburstChartSize(rootId: string, hierarchy: ReturnType<typeof buildHierarchy>): number {
  const { maxDepth, leaves } = sunburstTreeStats(rootId, hierarchy);
  const ringDepth = Math.max(1, maxDepth);
  const byDepth = 120 + ringDepth * 112 + 44;
  const byLeaves = (Math.max(1, leaves) * 44) / Math.PI + 64;
  return Math.ceil(Math.max(680, byDepth * 2, byLeaves));
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

function withSunburstNode(
  nodes: Node[],
  hierarchy: ReturnType<typeof buildHierarchy>,
  scopeIds: Set<string>,
  key: string,
  rootId: string | undefined,
  enabled: boolean
): Node[] {
  const restored = clearSunburstNodes(nodes);
  if (!enabled || !rootId) return restored;

  const rootNode = restored.find((node) => node.id === rootId);
  if (!rootNode) return restored;

  const rootRect = getNodeRect(rootNode);
  const rootCenter = {
    x: rootRect.x + rootRect.width / 2,
    y: rootRect.y + rootRect.height / 2,
  };
  const chartSize = sunburstChartSize(rootId, hierarchy);
  const hiddenNodes = restored.map((node) => {
    if (!scopeIds.has(node.id)) return node;
    return {
      ...node,
      hidden: true,
      data: { ...(node.data ?? {}), sunburstHiddenFor: key },
    };
  });
  const rootData = (rootNode.data ?? {}) as Record<string, unknown>;
  const title = typeof rootData.text === "string" ? rootData.text : typeof rootData.title === "string" ? rootData.title : "";
  const chartNode: Node = {
    id: `sunburst-${key}`,
    type: "sunburst",
    position: { x: rootCenter.x - chartSize / 2, y: rootCenter.y - chartSize / 2 },
    data: {
      rootId,
      sunburstFor: key,
      chartSize,
      title,
      locked: true,
      tags: [],
    },
    style: { width: chartSize, height: chartSize },
    zIndex: 20,
    selectable: false,
    draggable: false,
  };

  return [...hiddenNodes, chartNode];
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
    "fontFamily", "fontSize", "textColor", "scriptMode", "petalCount",
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

const AUTOFIT_NODE_TYPES = new Set(["shape", "sticky", "text", "mindmap"]);
const AUTOFIT_FIELDS = new Set([
  "text", "richText", "label", "title", "topic", "devanagari", "iast", "translation",
  "rule", "fontSize", "fontFamily", "fontStyle", "fontWeight", "textAlign",
  "shapeType", "petalCount", "borderWidth", "borderRadius", "borderStyle",
]);
const MIN_AUTO_NODE_WIDTH = 160;
const MIN_AUTO_NODE_HEIGHT = 56;
const MAX_AUTO_TEXT_WIDTH = 520;
const MAX_AUTO_CARD_WIDTH = 560;
const AUTOFIT_TEXT_PADDING_X = 28;
const AUTOFIT_TEXT_PADDING_Y = 22;

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function numericDimension(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function defaultVisualSize(node: Node): { w: number; h: number } {
  if (node.type === "sticky") return { w: 180, h: 90 };
  if (node.type === "text") return { w: 240, h: 56 };
  if (node.type === "mindmap") return { w: 180, h: 72 };
  if (node.type === "shape") {
    const shapeType = ((node.data ?? {}) as Record<string, unknown>).shapeType as string | undefined;
    if (shapeType === "circle" || shapeType === "diamond" || shapeType === "star" || shapeType === "flower") {
      return { w: 120, h: 120 };
    }
    if (shapeType === "leaf") return { w: 160, h: 96 };
    if (["document", "database", "predefinedProcess", "delay", "cloud"].includes(shapeType ?? "")) {
      return { w: 170, h: 96 };
    }
    return { w: 140, h: 80 };
  }
  return { w: 180, h: 80 };
}

function styleSizeOf(node: Node): { w: number; h: number } {
  const fallback = defaultVisualSize(node);
  const style = node.style as Record<string, unknown> | undefined;
  return {
    w: numericDimension(style?.width, fallback.w),
    h: numericDimension(style?.height, fallback.h),
  };
}

function stripHtmlToLines(value: string): string[] {
  const lines = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, index, all) => line || (index > 0 && index < all.length - 1));
  return lines.some(Boolean) ? lines : [];
}

function nodeTextLines(data: Record<string, unknown>): string[] {
  const richText = typeof data.richText === "string" ? stripHtmlToLines(data.richText) : [];
  if (richText.length) return richText;
  const text = getNodeText(data);
  return text
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line, index, all) => line || (index > 0 && index < all.length - 1));
}

function maxInlineFontSize(data: Record<string, unknown>): number | null {
  if (typeof data.richText !== "string") return null;
  const matches = [...data.richText.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/gi)];
  const sizes = matches.map((match) => Number(match[1])).filter(Number.isFinite);
  return sizes.length ? Math.max(...sizes) : null;
}

function textPaddingFor(node: Node, data: Record<string, unknown>): { x: number; y: number } {
  const borderWidth = typeof data.borderWidth === "number" ? data.borderWidth : 2;
  if (node.type === "sticky") return { x: 58 + AUTOFIT_TEXT_PADDING_X + borderWidth * 2, y: 42 + AUTOFIT_TEXT_PADDING_Y + borderWidth * 2 };
  if (node.type === "text") return { x: 34 + AUTOFIT_TEXT_PADDING_X + borderWidth * 2, y: 30 + AUTOFIT_TEXT_PADDING_Y + borderWidth * 2 };
  if (node.type === "mindmap") return { x: 40 + AUTOFIT_TEXT_PADDING_X + borderWidth * 2, y: 34 + AUTOFIT_TEXT_PADDING_Y + borderWidth * 2 };
  return { x: 48 + AUTOFIT_TEXT_PADDING_X + borderWidth * 2, y: 42 + AUTOFIT_TEXT_PADDING_Y + borderWidth * 2 };
}

function shapeFitFactor(shapeType: string): { width: number; height: number } {
  switch (shapeType) {
    case "circle":
      return { width: 1.42, height: 1.42 };
    case "star":
      return { width: 1.62, height: 1.62 };
    case "flower":
      return { width: 1.72, height: 1.72 };
    case "diamond":
      return { width: 1.52, height: 1.52 };
    case "triangle":
      return { width: 1.36, height: 1.68 };
    case "hexagon":
      return { width: 1.2, height: 1.2 };
    case "arrow":
      return { width: 1.42, height: 1.28 };
    case "callout":
    case "offPageConnector":
      return { width: 1.26, height: 1.36 };
    case "parallelogram":
    case "trapezoid":
      return { width: 1.28, height: 1.18 };
    case "document":
    case "database":
    case "predefinedProcess":
    case "delay":
    case "cloud":
    case "leaf":
      return { width: 1.22, height: 1.24 };
    case "capsule":
      return { width: 1.1, height: 1.08 };
    default:
      return { width: 1, height: 1 };
  }
}

function wrappedLineCount(lines: string[], maxChars: number): number {
  let count = 0;
  const safeMaxChars = Math.max(1, maxChars);
  for (const line of lines) {
    const words = line.split(/\s+/).filter(Boolean);
    if (!words.length) {
      count += 1;
      continue;
    }
    let current = 0;
    for (const word of words) {
      const wordLength = word.length;
      if (wordLength >= safeMaxChars) {
        if (current > 0) {
          count += 1;
          current = 0;
        }
        count += Math.ceil(wordLength / safeMaxChars);
        continue;
      }
      const nextLength = current === 0 ? wordLength : current + 1 + wordLength;
      if (nextLength > safeMaxChars) {
        count += 1;
        current = wordLength;
      } else {
        current = nextLength;
      }
    }
    if (current > 0) count += 1;
  }
  return Math.max(1, count);
}

function contentFitSize(node: Node, measuredContent?: ContentSize): { width: number; height: number } | null {
  if (!node.type || !AUTOFIT_NODE_TYPES.has(node.type)) return null;
  const data = node.data as Record<string, unknown>;
  const lines = nodeTextLines(data);
  const { w: currentWidth, h: currentHeight } = styleSizeOf(node);
  const shapeType = (data.shapeType as string | undefined) ?? "";

  if (!lines.length && !measuredContent) {
    if (node.type !== "shape") return null;
    const minimum = defaultVisualSize(node);
    let targetWidth = Math.max(currentWidth, minimum.w);
    let targetHeight = Math.max(currentHeight, minimum.h);
    if (shapeType === "circle" || shapeType === "diamond" || shapeType === "star" || shapeType === "flower") {
      const size = Math.max(targetWidth, targetHeight);
      targetWidth = size;
      targetHeight = size;
    }
    if (targetWidth <= currentWidth && targetHeight <= currentHeight) return null;
    return { width: Math.ceil(targetWidth), height: Math.ceil(targetHeight) };
  }

  const baseFontSize = typeof data.fontSize === "number" ? data.fontSize : 14;
  const fontSize = clampValue(Math.max(baseFontSize, maxInlineFontSize(data) ?? 0), 10, 96);
  const charWidth = Math.max(6, fontSize * 0.58);
  const lineHeight = fontSize * 1.38;
  const text = lines.join(" ");
  const words = text.split(/\s+/).filter(Boolean);
  const longestWord = words.reduce((max, word) => Math.max(max, word.length), 0);

  const minWidth = node.type === "text" ? MIN_AUTO_NODE_WIDTH : node.type === "sticky" ? 180 : 140;
  const minHeight = node.type === "sticky" ? 90 : node.type === "shape" ? 70 : MIN_AUTO_NODE_HEIGHT;
  const maxWidth = node.type === "text" ? MAX_AUTO_TEXT_WIDTH : MAX_AUTO_CARD_WIDTH;
  const padding = textPaddingFor(node, data);
  const padX = padding.x;
  const padY = padding.y;
  const preferredChars = clampValue(
    Math.ceil(Math.max(longestWord + 3, Math.sqrt(Math.max(text.length, 1)) * 4.2)),
    18,
    64
  );
  const width = clampValue(Math.ceil(preferredChars * charWidth + padX), minWidth, maxWidth);
  const charsPerLine = Math.max(8, Math.floor((width - padX) / charWidth));
  const currentCharsPerLine = Math.max(8, Math.floor((currentWidth - padX) / charWidth));
  const measuredLineHeight = measuredContent?.lineHeight && Number.isFinite(measuredContent.lineHeight)
    ? measuredContent.lineHeight
    : lineHeight;
  const measuredLineCount = measuredContent?.lineCount && Number.isFinite(measuredContent.lineCount)
    ? measuredContent.lineCount
    : 0;
  const lineAwareCount = Math.max(
    wrappedLineCount(lines, charsPerLine),
    wrappedLineCount(lines, currentCharsPerLine),
    measuredLineCount
  );
  const height = Math.ceil(lineAwareCount * Math.max(lineHeight, measuredLineHeight) + padY);

  let targetWidth = Math.max(currentWidth, width);
  let targetHeight = Math.max(currentHeight, Math.max(minHeight, height));
  if (measuredContent) {
    const measuredWidth = Number.isFinite(measuredContent.width) ? measuredContent.width : 0;
    const measuredHeight = Number.isFinite(measuredContent.height) ? measuredContent.height : 0;
    if (measuredWidth > 0) {
      targetWidth = Math.max(targetWidth, Math.min(maxWidth, Math.ceil(measuredWidth + padX)));
    }
    if (measuredHeight > 0) {
      targetHeight = Math.max(targetHeight, Math.ceil(measuredHeight + padY));
    }
  }
  if (node.type === "shape" && shapeType) {
    const factor = shapeFitFactor(shapeType);
    targetWidth = Math.max(targetWidth, Math.ceil(width * factor.width));
    targetHeight = Math.max(targetHeight, Math.ceil(height * factor.height));
  }
  if (shapeType === "circle" || shapeType === "diamond" || shapeType === "star" || shapeType === "flower") {
    const size = Math.max(targetWidth, targetHeight);
    targetWidth = size;
    targetHeight = size;
  }

  if (targetWidth <= currentWidth && targetHeight <= currentHeight) return null;
  return { width: Math.ceil(targetWidth), height: Math.ceil(targetHeight) };
}

function nodeRectWithSize(node: Node, position = node.position) {
  const { w, h } = styleSizeOf(node);
  return { id: node.id, x: position.x, y: position.y, width: w, height: h };
}

function findFreeResizedPosition(node: Node, nodes: Node[]) {
  const obstacles = nodes
    .filter((candidate) => candidate.id !== node.id && candidate.type !== "frame" && !isAutoMatrixFrame(candidate))
    .map(getNodeRect);
  const padding = 32;
  const rectAt = (position: { x: number; y: number }) => nodeRectWithSize(node, position);
  const isFree = (position: { x: number; y: number }) =>
    obstacles.every((obstacle) => !rectsOverlap(rectAt(position), obstacle, padding));

  if (isFree(node.position)) return node.position;

  const { w, h } = styleSizeOf(node);
  const stepX = Math.max(w + padding * 2, 140);
  const stepY = Math.max(h + padding * 2, 120);
  const base = node.position;
  const candidates: Array<{ x: number; y: number }> = [
    { x: base.x + stepX, y: base.y },
    { x: base.x, y: base.y + stepY },
    { x: base.x + stepX, y: base.y + stepY },
    { x: base.x - stepX, y: base.y },
    { x: base.x, y: base.y - stepY },
    { x: base.x + stepX, y: base.y - stepY },
    { x: base.x - stepX, y: base.y + stepY },
  ];

  for (let ring = 2; ring <= 7; ring++) {
    candidates.push(
      { x: base.x + stepX * ring, y: base.y },
      { x: base.x, y: base.y + stepY * ring },
      { x: base.x + stepX * ring, y: base.y + stepY },
      { x: base.x - stepX * ring, y: base.y },
      { x: base.x, y: base.y - stepY * ring }
    );
  }

  return candidates.find(isFree) ?? node.position;
}

function patchNeedsContentFit(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).some((key) => AUTOFIT_FIELDS.has(key));
}

function fitNodeAfterContentChange(node: Node, nodes: Node[], measuredContent?: ContentSize): Node {
  const fit = contentFitSize(node, measuredContent);
  if (!fit) return node;
  const resized = {
    ...node,
    style: { ...(node.style ?? {}), width: fit.width, height: fit.height },
  };
  return { ...resized, position: findFreeResizedPosition(resized, nodes) };
}

function nodeRectAt(node: Node, offset: { x: number; y: number } = { x: 0, y: 0 }) {
  const { w, h } = sizeOf(node);
  return {
    id: node.id,
    x: node.position.x + offset.x,
    y: node.position.y + offset.y,
    width: w,
    height: h,
  };
}

function groupBounds(nodes: Node[]) {
  const rects = nodes.map((node) => nodeRectAt(node));
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function clearDuplicatedContent(data: Record<string, unknown>, originalId: string, idMap: Map<string, string>) {
  const next = structuredClone(data);
  const textFields = [
    "text", "richText", "label", "title", "topic", "devanagari", "iast", "translation",
    "rule", "source", "sourceText", "padaccheda", "anvaya", "padartha", "chandas",
    "grammarNotes", "exceptions", "notes",
  ];
  for (const field of textFields) {
    if (field in next) next[field] = "";
  }
  if (Array.isArray(next.examples)) next.examples = [];
  if (Array.isArray(next.tags)) next.tags = [];
  if (Array.isArray(next.collapsedSections)) next.collapsedSections = [];

  const parentId = typeof next.parentId === "string" ? next.parentId : null;
  next.parentId = parentId && idMap.has(parentId) ? idMap.get(parentId)! : null;
  const childOrder = Array.isArray(next.childOrder) ? next.childOrder : [];
  const mappedChildOrder = childOrder
    .filter((childId): childId is string => typeof childId === "string" && idMap.has(childId))
    .map((childId) => idMap.get(childId)!);
  next.childOrder = mappedChildOrder;
  if (originalId === parentId || mappedChildOrder.length === 0) delete next.layoutMode;

  return next;
}

function duplicateNodeStyle(node: Node) {
  const { w, h } = sizeOf(node);
  return { ...(node.style ?? {}), width: w, height: h };
}

function findFreeDuplicateOffset(selectedNodes: Node[], allNodes: Node[]) {
  if (!selectedNodes.length) return { x: 40, y: 40 };
  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const obstacles = allNodes
    .filter((node) => !selectedIds.has(node.id) && !isAutoMatrixFrame(node))
    .map(getNodeRect);
  const bounds = groupBounds(selectedNodes);
  const padding = 28;
  const stepX = Math.max(bounds.width + padding * 2, 120);
  const stepY = Math.max(bounds.height + padding * 2, 100);

  const isFree = (offset: { x: number; y: number }) => {
    const duplicatedRects = selectedNodes.map((node) => nodeRectAt(node, offset));
    return duplicatedRects.every((rect, index) => {
      const clearOfExisting = obstacles.every((obstacle) => !rectsOverlap(rect, obstacle, padding));
      if (!clearOfExisting) return false;
      return duplicatedRects.every((other, otherIndex) =>
        index === otherIndex || !rectsOverlap(rect, other, padding)
      );
    });
  };

  const candidates: Array<{ x: number; y: number }> = [
    { x: stepX, y: 0 },
    { x: 0, y: stepY },
    { x: stepX, y: stepY },
    { x: stepX, y: -stepY },
    { x: -stepX, y: 0 },
    { x: 0, y: -stepY },
    { x: -stepX, y: stepY },
    { x: -stepX, y: -stepY },
  ];

  for (let ring = 1; ring <= 8; ring++) {
    for (let gy = -ring; gy <= ring; gy++) {
      for (let gx = -ring; gx <= ring; gx++) {
        if (Math.max(Math.abs(gx), Math.abs(gy)) !== ring) continue;
        if (gx === 0 && gy === 0) continue;
        candidates.push({ x: gx * stepX, y: gy * stepY });
      }
    }
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.x}:${candidate.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isFree(candidate)) return candidate;
  }

  return { x: stepX, y: stepY };
}

function buildDuplicateSelection(selectedNodes: Node[], selectedEdges: Edge[], allNodes: Node[]) {
  const offset = findFreeDuplicateOffset(selectedNodes, allNodes);
  const idMap = new Map(selectedNodes.map((node) => [node.id, generateId()]));

  const nodes = selectedNodes.map((node) => {
    const newId = idMap.get(node.id)!;
    const data = clearDuplicatedContent(node.data as Record<string, unknown>, node.id, idMap);
    return {
      ...structuredClone(node),
      id: newId,
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
      data,
      style: duplicateNodeStyle(node),
      selected: true,
    };
  });

  const edges = selectedEdges
    .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
    .map((edge) => ({
      ...structuredClone(edge),
      id: generateId(),
      source: idMap.get(edge.source)!,
      target: idMap.get(edge.target)!,
      selected: false,
    }));

  return { nodes, edges };
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  board: null,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: { ...DEFAULT_BOARD_SETTINGS },
  selectedNodeIds: [],
  selectedEdgeIds: [],
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
  setSelectedEdgeIds: (ids) => set({ selectedEdgeIds: ids }),

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

  duplicateNode: (nodeId) => {
    const { nodes, edges } = get();
    const source = nodes.find((node) => node.id === nodeId);
    if (!source) return;
    get().pushHistory();
    const { nodes: newNodes } = buildDuplicateSelection([source], [], nodes);
    set({
      nodes: [...nodes.map((node) => ({ ...node, selected: false })), ...newNodes],
      edges: edges.map((edge) => ({ ...edge, selected: false })),
      selectedNodeIds: newNodes.map((node) => node.id),
      selectedEdgeIds: [],
      saveStatus: "unsaved",
    });
  },

  duplicateSelected: () => {
    const { nodes, edges, selectedNodeIds } = get();
    if (!selectedNodeIds.length) return;
    get().pushHistory();
    const selectedSet = new Set(selectedNodeIds);
    const selectedNodes = nodes.filter((node) => selectedSet.has(node.id));
    const selectedEdges = edges.filter((edge) => selectedSet.has(edge.source) && selectedSet.has(edge.target));
    const { nodes: newNodes, edges: newEdges } = buildDuplicateSelection(selectedNodes, selectedEdges, nodes);
    set({
      nodes: [...nodes.map((node) => ({ ...node, selected: false })), ...newNodes],
      edges: [...edges.map((edge) => ({ ...edge, selected: false })), ...newEdges],
      selectedNodeIds: newNodes.map((node) => node.id),
      selectedEdgeIds: [],
      saveStatus: "unsaved",
    });
  },

  deleteSelected: () => {
    const { selectedNodeIds, selectedEdgeIds, nodes, edges } = get();
    if (!selectedNodeIds.length && !selectedEdgeIds.length) return;
    get().pushHistory();
    const selectedNodes = new Set(selectedNodeIds);
    const selectedEdges = new Set(selectedEdgeIds);
    set({
      nodes: nodes.filter((n) => !selectedNodes.has(n.id)),
      edges: edges.filter(
        (e) => !selectedEdges.has(e.id) && !selectedNodes.has(e.source) && !selectedNodes.has(e.target)
      ),
      selectedNodeIds: [],
      selectedEdgeIds: [],
      saveStatus: "unsaved",
    });
  },

  deleteEdges: (ids) => {
    if (!ids.length) return;
    const { edges, selectedEdgeIds } = get();
    const removeIds = new Set(ids);
    if (!edges.some((edge) => removeIds.has(edge.id))) return;
    get().pushHistory();
    set({
      edges: edges.filter((edge) => !removeIds.has(edge.id)),
      selectedEdgeIds: selectedEdgeIds.filter((id) => !removeIds.has(id)),
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
    const hiddenInSunburst = mode === "radial";
    const newEdge: Edge = {
      id: generateId(),
      source: parentId,
      target: childId,
      type: "branch",
      hidden: hiddenInMatrix || hiddenInSunburst,
      sourceHandle: route.sourceHandle,
      targetHandle: route.targetHandle,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" },
      data: {
        edgeType: "branch",
        curveStyle: route.curveStyle,
        hiddenInMatrix,
        hiddenInSunburst,
        hiddenInSunburstFor: hiddenInSunburst ? sunburstFrameKey(parentId) : undefined,
        layoutMode: mode,
      },
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
    const useSunburst = layoutRoot.mode === "radial";
    const placements = layoutRoot.mode && !useSunburst
      ? computeLayout(nextNodes, nextEdges, layoutRoot.mode, { rootId: layoutRoot.id })
      : resolveInsertedNodeCollisions(nextNodes, childId);
    const placedNodes = applyPlacements(nextNodes, placements);
    const rootScope = new Set(getSubtree(layoutRoot.id, nextHierarchy));
    const matrixNodes = layoutRoot.mode === "matrix"
      ? withMatrixFrame(placedNodes, rootScope, matrixFrameKey(layoutRoot.id), true)
      : placedNodes;
    const finalNodes = useSunburst
      ? withSunburstNode(matrixNodes, nextHierarchy, rootScope, sunburstFrameKey(layoutRoot.id), layoutRoot.id, true)
      : matrixNodes;

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
      const hiddenInSunburst = edgeMode === "radial";
      newEdges.push({
        id: generateId(),
        source: parentEdge.source,
        target: siblingId,
        type: "branch",
        hidden: hiddenInMatrix || hiddenInSunburst,
        sourceHandle: route.sourceHandle,
        targetHandle: route.targetHandle,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" },
        data: {
          edgeType: "branch",
          curveStyle: route.curveStyle,
          hiddenInMatrix,
          hiddenInSunburst,
          hiddenInSunburstFor: hiddenInSunburst ? sunburstFrameKey(parentEdge.source) : undefined,
          layoutMode: edgeMode,
        },
      });
    }
    const nextNodes = [...nodes, newNode];
    const nextHierarchy = buildHierarchy(nextNodes, newEdges);
    const layoutRoot = findLayoutRoot(parentEdge?.source ?? nodeId, nextNodes, nextHierarchy);
    const useSunburst = layoutRoot.mode === "radial";
    const placements = layoutRoot.mode && !useSunburst
      ? computeLayout(nextNodes, newEdges, layoutRoot.mode, { rootId: layoutRoot.id })
      : resolveInsertedNodeCollisions(nextNodes, siblingId);
    const placedNodes = applyPlacements(nextNodes, placements);
    const rootScope = new Set(getSubtree(layoutRoot.id, nextHierarchy));
    const matrixNodes = layoutRoot.mode === "matrix"
      ? withMatrixFrame(placedNodes, rootScope, matrixFrameKey(layoutRoot.id), true)
      : placedNodes;
    const finalNodes = useSunburst
      ? withSunburstNode(matrixNodes, nextHierarchy, rootScope, sunburstFrameKey(layoutRoot.id), layoutRoot.id, true)
      : matrixNodes;

    set({
      nodes: finalNodes,
      edges: newEdges,
      selectedNodeIds: [siblingId],
      saveStatus: "unsaved",
    });
  },

  updateNodeData: (nodeId, data) => {
    set((state) => {
      let updatedNode: Node | null = null;
      let nodes = state.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        updatedNode = { ...n, data: { ...n.data, ...data } };
        return updatedNode;
      });

      if (updatedNode && patchNeedsContentFit(data)) {
        const fitted = fitNodeAfterContentChange(updatedNode, nodes);
        nodes = nodes.map((n) => (n.id === nodeId ? fitted : n));
      }

      return { nodes, saveStatus: "unsaved" };
    });
  },

  fitNodeToContent: (nodeId, contentSize) => {
    set((state) => {
      const node = state.nodes.find((n) => n.id === nodeId);
      if (!node) return {};

      const fitted = fitNodeAfterContentChange(node, state.nodes, contentSize);
      if (fitted === node) return {};

      const prevStyle = (node.style ?? {}) as Record<string, unknown>;
      const nextStyle = (fitted.style ?? {}) as Record<string, unknown>;
      const geometryChanged =
        node.position.x !== fitted.position.x ||
        node.position.y !== fitted.position.y ||
        prevStyle.width !== nextStyle.width ||
        prevStyle.height !== nextStyle.height;

      if (!geometryChanged) return {};

      return {
        nodes: state.nodes.map((n) => (n.id === nodeId ? fitted : n)),
        saveStatus: "unsaved" as SaveStatus,
      };
    });
  },

  resizeNodeToFitBounds: (nodeId, bounds) => {
    set((state) => {
      const node = state.nodes.find((n) => n.id === nodeId);
      if (!node) return {};

      const current = styleSizeOf(node);
      let width = Math.max(current.w, Math.ceil(bounds.width));
      let height = Math.max(current.h, Math.ceil(bounds.height));
      const shapeType = ((node.data ?? {}) as Record<string, unknown>).shapeType as string | undefined;
      if (shapeType === "circle" || shapeType === "diamond" || shapeType === "star" || shapeType === "flower") {
        const size = Math.max(width, height);
        width = size;
        height = size;
      }

      if (width <= current.w + 1 && height <= current.h + 1) return {};

      const resized = {
        ...node,
        style: { ...(node.style ?? {}), width, height },
      };
      const fitted = { ...resized, position: findFreeResizedPosition(resized, state.nodes) };

      return {
        nodes: state.nodes.map((n) => (n.id === nodeId ? fitted : n)),
        saveStatus: "unsaved" as SaveStatus,
      };
    });
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
    if (shapeType === "circle" || shapeType === "flower")   { const s = Math.max(curW, curH, 120); newStyle = { ...newStyle, width: s, height: s }; }
    if (shapeType === "star")     { const s = Math.max(curW, curH, 120); newStyle = { ...newStyle, width: s, height: s }; }
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
    const layoutNodes = nodes.filter((n) => !isAutoMatrixFrame(n) && !isAutoSunburstNode(n));
    const selectedRootId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : undefined;
    const rootId = selectedRootId && layoutNodes.some((n) => n.id === selectedRootId) ? selectedRootId : undefined;
    if (!rootId) return;
    const sunburstEnabled = mode === "radial" && !!rootId;
    const sunburstKey = sunburstFrameKey(rootId);

    const hierarchy = buildHierarchy(layoutNodes, edges);
    const positions = sunburstEnabled ? {} : computeLayout(layoutNodes, edges, mode, { rootId });

    // Nodes in scope: the selected subtree, or the whole board when nothing selected.
    const scopeIds = rootId
      ? new Set(getSubtree(rootId, hierarchy))
      : new Set(layoutNodes.map((n) => n.id));

    get().pushHistory();

    const byId = new Map(layoutNodes.map((n) => [n.id, n]));

    // Reroute parent→child edges within scope, using post-layout geometry.
    const newEdges = edges.map((e) => {
      const originalData = (e.data ?? {}) as Record<string, unknown>;
      let edge = e;
      if (originalData.hiddenInSunburst && (!sunburstEnabled || originalData.hiddenInSunburstFor !== sunburstKey)) {
        const { hiddenInSunburst: _hiddenInSunburst, hiddenInSunburstFor: _hiddenInSunburstFor, ...restData } = originalData;
        void _hiddenInSunburst;
        void _hiddenInSunburstFor;
        edge = {
          ...e,
          hidden: !!restData.hiddenInMatrix,
          data: restData,
        };
      }

      const touchesScope = scopeIds.has(e.source) || scopeIds.has(e.target);
      const insideScope = scopeIds.has(e.source) && scopeIds.has(e.target);
      if (!touchesScope) return edge;
      if (!insideScope) {
        const hiddenInMatrix = mode === "matrix";
        const hiddenInSunburst = false;
        return {
          ...edge,
          hidden: hiddenInMatrix || hiddenInSunburst,
          data: { ...(edge.data ?? {}), hiddenInMatrix, hiddenInSunburst, layoutMode: mode },
        };
      }
      const parent = byId.get(edge.source);
      const child = byId.get(edge.target);
      if (!parent || !child) return edge;
      const pParent = positions[edge.source] ? { ...parent, position: positions[edge.source] } : parent;
      const pChild = positions[edge.target] ? { ...child, position: positions[edge.target] } : child;
      const route = routeForMode(mode, pParent, pChild);
      const hiddenInMatrix = mode === "matrix";
      const hiddenInSunburst = !!sunburstEnabled && hierarchy.get(edge.target)?.parentId === edge.source;
      return {
        ...edge,
        hidden: hiddenInMatrix || hiddenInSunburst,
        sourceHandle: route.sourceHandle,
        targetHandle: route.targetHandle,
        markerEnd: edge.markerEnd ?? { type: MarkerType.ArrowClosed, color: "#6366f1" },
        data: {
          ...(edge.data ?? {}),
          edgeType: "branch",
          curveStyle: route.curveStyle,
          hiddenInMatrix,
          hiddenInSunburst,
          hiddenInSunburstFor: hiddenInSunburst ? sunburstKey : undefined,
          layoutMode: mode,
        },
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
    const framedNodes = withMatrixFrame(
      [...laidOutNodes, ...existingMatrixFrames],
      scopeIds,
      frameKey,
      mode === "matrix"
    );
    const newNodes = withSunburstNode(
      framedNodes,
      hierarchy,
      scopeIds,
      sunburstKey,
      rootId,
      sunburstEnabled
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
