"use client";

import { memo, useId, useMemo, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import type { SunburstNodeData } from "@/lib/types";
import { buildHierarchy, type Hierarchy } from "@/lib/layout/hierarchy";
import { useCanvasStore } from "@/store/canvas-store";

type PolarPoint = { x: number; y: number };

type SunburstTreeNode = {
  id: string;
  depth: number;
  siblingIndex: number;
  branchIndex: number;
  weight: number;
  startAngle: number;
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
  children: SunburstTreeNode[];
};

type SunburstSegment = SunburstTreeNode & {
  label: string;
  fill: string;
};

const ROOT_START_ANGLE = -90;
const ROOT_END_ANGLE = 270;
const CHART_PADDING = 22;
const BRANCH_HUES = [348, 42, 62, 164, 198, 246, 286, 18, 122, 322, 94, 214];

function dimension(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function nodeLabel(node: Node | undefined): string {
  if (!node) return "";
  const data = (node.data ?? {}) as Record<string, unknown>;
  const richText = typeof data.richText === "string" ? data.richText.replace(/<[^>]+>/g, " ") : "";
  const fields = ["text", "title", "topic", "label", "devanagari", "iast", "translation", "rule"];
  const text = fields
    .map((field) => data[field])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
  return (text || richText || node.id).replace(/\s+/g, " ").trim();
}

function pointOnCircle(cx: number, cy: number, radius: number, angleDeg: number): PolarPoint {
  const angle = (angleDeg * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function arcSegmentPath(cx: number, cy: number, innerRadius: number, outerRadius: number, startAngle: number, endAngle: number): string {
  const span = Math.max(0.01, endAngle - startAngle);
  const largeArc = span > 180 ? 1 : 0;
  const outerStart = pointOnCircle(cx, cy, outerRadius, startAngle);
  const outerEnd = pointOnCircle(cx, cy, outerRadius, endAngle);
  const innerEnd = pointOnCircle(cx, cy, innerRadius, endAngle);
  const innerStart = pointOnCircle(cx, cy, innerRadius, startAngle);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function wrapLabel(label: string, maxChars: number): string[] {
  const safeChars = Math.max(1, Math.floor(maxChars));
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words.length ? words : [label]) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > safeChars && current) {
      lines.push(current);
      current = word;
    } else if (word.length > safeChars) {
      if (current) lines.push(current);
      for (let offset = 0; offset < word.length; offset += safeChars) {
        lines.push(word.slice(offset, offset + safeChars));
      }
      current = "";
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [label.slice(0, safeChars)];
}

function ellipsizeLastLine(lines: string[], maxChars: number): string[] {
  if (!lines.length) return lines;
  const last = lines[lines.length - 1];
  const safeChars = Math.max(1, maxChars);
  if (last.length < safeChars) return lines;
  return [
    ...lines.slice(0, -1),
    safeChars <= 3 ? last.slice(0, safeChars) : `${last.slice(0, safeChars - 1)}…`,
  ];
}

function fitSectorLabel(label: string, arcLength: number, radialBand: number, depth: number): { lines: string[]; fontSize: number } {
  if (!label.trim()) return { lines: [], fontSize: 0 };

  const availableWidth = Math.max(4, arcLength * 0.78);
  const availableHeight = Math.max(4, radialBand * 0.72);
  const maxFont = Math.max(6, Math.min(depth <= 1 ? 28 : 20, radialBand * 0.34, availableWidth * 0.2));
  const minFont = 4;

  for (let fontSize = maxFont; fontSize >= minFont; fontSize -= 0.5) {
    const maxChars = Math.max(1, Math.floor(availableWidth / Math.max(1, fontSize * 0.54)));
    const lines = wrapLabel(label, maxChars);
    const longest = Math.max(1, ...lines.map((line) => line.length));
    const widthFits = longest * fontSize * 0.54 <= availableWidth;
    const heightFits = lines.length * fontSize * 1.1 <= availableHeight;
    if (widthFits && heightFits) return { lines, fontSize };
  }

  const maxChars = Math.max(1, Math.floor(availableWidth / Math.max(1, minFont * 0.54)));
  const maxLines = Math.max(1, Math.floor(availableHeight / (minFont * 1.1)));
  const wrapped = wrapLabel(label, maxChars);
  return { lines: ellipsizeLastLine(wrapped.slice(0, maxLines), maxChars), fontSize: minFont };
}

function fitCircleLabel(label: string, radius: number): { lines: string[]; fontSize: number } {
  if (!label.trim() || radius <= 0) return { lines: [], fontSize: 0 };

  const availableWidth = Math.max(4, radius * 1.55);
  const availableHeight = Math.max(4, radius * 1.5);
  const maxFont = Math.max(10, Math.min(32, radius * 0.34));
  const minFont = 5;

  for (let fontSize = maxFont; fontSize >= minFont; fontSize -= 0.5) {
    const maxChars = Math.max(1, Math.floor(availableWidth / Math.max(1, fontSize * 0.54)));
    const lines = wrapLabel(label, maxChars);
    const longest = Math.max(1, ...lines.map((line) => line.length));
    const widthFits = longest * fontSize * 0.54 <= availableWidth;
    const heightFits = lines.length * fontSize * 1.12 <= availableHeight;
    if (widthFits && heightFits) return { lines, fontSize };
  }

  const maxChars = Math.max(1, Math.floor(availableWidth / Math.max(1, minFont * 0.54)));
  const maxLines = Math.max(1, Math.floor(availableHeight / (minFont * 1.12)));
  const wrapped = wrapLabel(label, maxChars);
  return { lines: ellipsizeLastLine(wrapped.slice(0, maxLines), maxChars), fontSize: minFont };
}

function textColorForDepth(depth: number): string {
  return depth <= 1 ? "#f8fafc" : "#0f172a";
}

function segmentFill(branchIndex: number, depth: number, siblingIndex: number): string {
  const hue = (BRANCH_HUES[branchIndex % BRANCH_HUES.length] + siblingIndex * 3) % 360;
  const saturation = Math.max(48, 76 - depth * 4);
  const lightness = Math.min(84, 48 + depth * 8);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function buildSunburstTree(rootId: string, hierarchy: Hierarchy): SunburstTreeNode {
  const build = (id: string, depth: number, siblingIndex: number, branchIndex: number): SunburstTreeNode => {
    const childIds = hierarchy.get(id)?.childIds ?? [];
    const children = childIds.map((childId, index) =>
      build(childId, depth + 1, index, depth === 0 ? index : branchIndex)
    );
    const weight = children.length ? children.reduce((sum, child) => sum + child.weight, 0) : 1;
    return {
      id,
      depth,
      siblingIndex,
      branchIndex,
      weight,
      startAngle: ROOT_START_ANGLE,
      endAngle: ROOT_END_ANGLE,
      innerRadius: 0,
      outerRadius: 0,
      children,
    };
  };
  return build(rootId, 0, 0, 0);
}

function maxDepthOf(node: SunburstTreeNode): number {
  return Math.max(node.depth, ...node.children.map(maxDepthOf));
}

function assignGeometry(node: SunburstTreeNode, centerRadius: number, ringWidth: number): void {
  if (node.depth === 0) {
    node.innerRadius = 0;
    node.outerRadius = centerRadius;
  } else {
    node.innerRadius = centerRadius + (node.depth - 1) * ringWidth;
    node.outerRadius = node.innerRadius + ringWidth;
  }

  let currentAngle = node.startAngle;
  const span = node.endAngle - node.startAngle;
  for (const child of node.children) {
    const childSpan = span * (child.weight / Math.max(1, node.weight));
    child.startAngle = currentAngle;
    child.endAngle = currentAngle + childSpan;
    assignGeometry(child, centerRadius, ringWidth);
    currentAngle += childSpan;
  }
}

function collectSegments(node: SunburstTreeNode, byId: Map<string, Node>): SunburstSegment[] {
  const segments: SunburstSegment[] = [];
  const walk = (candidate: SunburstTreeNode) => {
    if (candidate.depth > 0) {
      segments.push({
        ...candidate,
        label: nodeLabel(byId.get(candidate.id)),
        fill: segmentFill(candidate.branchIndex, candidate.depth, candidate.siblingIndex),
      });
    }
    candidate.children.forEach(walk);
  };
  walk(node);
  return segments;
}

function selectOriginalNode(nodeId: string): void {
  useCanvasStore.setState((state) => ({
    nodes: state.nodes.map((node) => ({ ...node, selected: node.id === nodeId })),
    edges: state.edges.map((edge) => ({ ...edge, selected: false })),
    selectedNodeIds: [nodeId],
    selectedEdgeIds: [],
  }));
}

function SunburstNodeComponent({ data }: NodeProps) {
  const d = data as SunburstNodeData;
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const selectedNodeIds = useCanvasStore((state) => state.selectedNodeIds);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const clipPrefix = `sunburst-clip-${useId().replace(/:/g, "")}`;

  const model = useMemo(() => {
    const chartNodes = nodes.filter((node) => node.type !== "sunburst" && node.type !== "frame");
    const byId = new Map(chartNodes.map((node) => [node.id, node]));
    const root = byId.get(d.rootId);
    if (!root) return null;

    const hierarchy = buildHierarchy(chartNodes, edges);
    const tree = buildSunburstTree(d.rootId, hierarchy);
    const maxDepth = Math.max(1, maxDepthOf(tree));
    const size = dimension(d.chartSize, 720);
    const outerRadius = size / 2 - CHART_PADDING;
    const centerRadius = Math.max(82, Math.min(140, outerRadius * 0.28));
    const ringWidth = maxDepth > 0 ? Math.max(72, (outerRadius - centerRadius) / maxDepth) : 0;
    tree.startAngle = ROOT_START_ANGLE;
    tree.endAngle = ROOT_END_ANGLE;
    assignGeometry(tree, centerRadius, ringWidth);

    return {
      root,
      byId,
      tree,
      size,
      center: size / 2,
      centerRadius,
      segments: collectSegments(tree, byId),
    };
  }, [d.chartSize, d.rootId, edges, nodes]);

  if (!model) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-lg border border-dashed bg-background text-xs text-muted-foreground">
        Sunburst root missing
      </div>
    );
  }

  const rootLabel = nodeLabel(model.root);
  const rootFit = fitCircleLabel(rootLabel, model.centerRadius);
  const rootClipId = `${clipPrefix}-root`;

  return (
    <div className="h-full w-full">
      <svg
        viewBox={`0 0 ${model.size} ${model.size}`}
        className="h-full w-full overflow-visible"
        role="img"
        aria-label={`Sunburst chart for ${rootLabel}`}
      >
        <defs>
          <clipPath id={rootClipId}>
            <circle cx={model.center} cy={model.center} r={model.centerRadius} />
          </clipPath>
        </defs>
        <circle
          cx={model.center}
          cy={model.center}
          r={model.size / 2 - CHART_PADDING / 2}
          fill="rgba(15,23,42,0.03)"
          stroke="rgba(148,163,184,0.45)"
          strokeWidth="1"
        />
        {model.segments.map((segment) => {
          const label = segment.label;
          const midAngle = (segment.startAngle + segment.endAngle) / 2;
          const textRadius = (segment.innerRadius + segment.outerRadius) / 2;
          const textPoint = pointOnCircle(model.center, model.center, textRadius, midAngle);
          const normalized = ((midAngle % 360) + 360) % 360;
          const rotation = normalized > 90 && normalized < 270 ? midAngle + 180 : midAngle;
          const angleSpan = segment.endAngle - segment.startAngle;
          const arcLength = (angleSpan * Math.PI * textRadius) / 180;
          const band = segment.outerRadius - segment.innerRadius;
          const labelFit = fitSectorLabel(label, arcLength, band, segment.depth);
          const selected = selectedNodeIds.includes(segment.id);
          const hovered = hoveredId === segment.id;
          const showText = labelFit.lines.length > 0 && angleSpan > 1.8;
          const segmentPath = arcSegmentPath(model.center, model.center, segment.innerRadius, segment.outerRadius, segment.startAngle, segment.endAngle);
          const segmentClipId = `${clipPrefix}-${segment.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
          const lineOffset = -((labelFit.lines.length - 1) * labelFit.fontSize * 1.1) / 2;

          return (
            <g key={segment.id}>
              <defs>
                <clipPath id={segmentClipId}>
                  <path d={segmentPath} />
                </clipPath>
              </defs>
              <path
                d={segmentPath}
                fill={segment.fill}
                stroke={selected ? "#2563eb" : hovered ? "#0f172a" : "rgba(255,255,255,0.92)"}
                strokeWidth={selected ? 3 : hovered ? 2 : 1.4}
                className="cursor-pointer transition-opacity"
                opacity={hoveredId && !hovered && !selected ? 0.72 : 1}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseEnter={() => setHoveredId(segment.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  selectOriginalNode(segment.id);
                }}
              >
                <title>{label}</title>
              </path>
              {showText && (
                <g clipPath={`url(#${segmentClipId})`}>
                  <text
                    x={textPoint.x}
                    y={textPoint.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    pointerEvents="none"
                    fill={textColorForDepth(segment.depth)}
                    fontSize={labelFit.fontSize}
                    fontWeight={segment.depth <= 1 ? 700 : 600}
                    transform={`rotate(${rotation} ${textPoint.x} ${textPoint.y})`}
                  >
                    {labelFit.lines.map((line, index) => (
                      <tspan
                        key={`${segment.id}-line-${index}`}
                        x={textPoint.x}
                        dy={index === 0 ? lineOffset : labelFit.fontSize * 1.1}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              )}
            </g>
          );
        })}
        <circle
          cx={model.center}
          cy={model.center}
          r={model.centerRadius}
          fill="hsl(28, 52%, 24%)"
          stroke="#a16207"
          strokeWidth="4"
          className="cursor-pointer"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            selectOriginalNode(d.rootId);
          }}
        >
          <title>{rootLabel}</title>
        </circle>
        <g clipPath={`url(#${rootClipId})`}>
          <text
            x={model.center}
            y={model.center}
            textAnchor="middle"
            dominantBaseline="middle"
            pointerEvents="none"
            fill="#f8fafc"
            fontSize={rootFit.fontSize}
            fontWeight="800"
          >
            {rootFit.lines.map((line, index) => (
              <tspan
                key={`${line}-${index}`}
                x={model.center}
                dy={index === 0 ? -((rootFit.lines.length - 1) * rootFit.fontSize * 1.12) / 2 : rootFit.fontSize * 1.12}
              >
                {line}
              </tspan>
            ))}
          </text>
        </g>
      </svg>
    </div>
  );
}

export const SunburstNode = memo(SunburstNodeComponent);
