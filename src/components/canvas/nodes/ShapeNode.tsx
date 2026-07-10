"use client";

import { memo, useState, useEffect, useRef, useCallback, useMemo, useId, type CSSProperties, type ReactNode } from "react";
import { NodeResizer, useViewport, type NodeProps } from "@xyflow/react";
import { Layers2, Plus } from "lucide-react";
import { cn, generateId } from "@/lib/utils";
import { NodeHandles } from "./NodeHandles";
import {
  getTextStyle, resolveFillColor, resolveBorderColor,
  resolveBorderWidth, resolveFillOpacity,
  colorWithOpacity,
} from "@/lib/style-utils";
import type {
  ShapeNodeData,
  InternalFillRegion,
  BorderLayer,
  ConcentricShapeLayer,
  RadialChartData,
  RadialChartRing,
  RadialChartSegment,
  ShapeType,
} from "@/lib/types";
import { useCanvasStore } from "@/store/canvas-store";
import { useUIStore } from "@/store/ui-store";
import { RichTextEditor } from "../RichTextEditor";
import { InternalFillLayer } from "../InternalFillLayer";
import { BorderLayers } from "../BorderLayers";
import { NodeQuickActions } from "./NodeQuickActions";
import { useNodeContentAutoFit } from "./useNodeContentAutoFit";

const CLIP_PATHS: Partial<Record<string, string>> = {
  diamond:  "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
  triangle: "polygon(50% 0%, 0% 100%, 100% 100%)",
  hexagon:  "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
  star:     "polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)",
  arrow:    "polygon(0% 25%,60% 25%,60% 0%,100% 50%,60% 100%,60% 75%,0% 75%)",
  parallelogram: "polygon(16% 0%, 100% 0%, 84% 100%, 0% 100%)",
  trapezoid: "polygon(18% 0%, 82% 0%, 100% 100%, 0% 100%)",
  offPageConnector: "polygon(0% 0%, 100% 0%, 100% 76%, 50% 100%, 0% 76%)",
  callout: "polygon(0% 0%, 100% 0%, 100% 78%, 64% 78%, 50% 100%, 38% 78%, 0% 78%)",
};

// SVG polygon points (in a 0–100 viewBox) matching the clip paths above.
const POLYGON_POINTS: Partial<Record<string, string>> = {
  diamond:  "50,1 99,50 50,99 1,50",
  triangle: "50,1 1,99 99,99",
  hexagon:  "25,1 75,1 99,50 75,99 25,99 1,50",
  star:     "50,1 61,35 98,35 68,57 79,91 50,70 21,91 32,57 2,35 39,35",
  arrow:    "1,25 60,25 60,1 99,50 60,99 60,75 1,75",
  parallelogram: "16,1 99,1 84,99 1,99",
  trapezoid: "18,1 82,1 99,99 1,99",
  offPageConnector: "1,1 99,1 99,76 50,99 1,76",
  callout: "1,1 99,1 99,78 64,78 50,99 38,78 1,78",
};

const DEFAULT_RADIUS: Partial<Record<string, number>> = {
  rectangle: 0, rounded: 16, circle: 9999, capsule: 9999,
};

const CUSTOM_SVG_SHAPES = new Set([
  "document",
  "database",
  "predefinedProcess",
  "delay",
  "cloud",
  "flower",
  "leaf",
]);

const SQUARE_ASPECT_SHAPES = new Set(["circle", "diamond", "star", "flower"]);
const CONCENTRIC_INSET_STEP = 6;

function dashArray(style: string, w: number): string | undefined {
  if (style === "dashed") return `${w * 2.5} ${w * 1.5}`;
  if (style === "dotted") return `0.1 ${w * 2}`;
  return undefined;
}

function isSvgShape(shapeType: string): boolean {
  return shapeType in POLYGON_POINTS || CUSTOM_SVG_SHAPES.has(shapeType);
}

function concentricInset(index: number, total: number): number {
  const step = Math.min(CONCENTRIC_INSET_STEP, 48 / Math.max(1, total + 1));
  return step * (index + 1);
}

function normalizePetalCount(value: unknown): number {
  return Math.max(4, Math.min(16, Math.round(typeof value === "number" ? value : 8)));
}

function layerFillColor(layer: ConcentricShapeLayer): string | undefined {
  if (!layer.fillColor || layer.fillColor === "transparent") return "transparent";
  return colorWithOpacity(layer.fillColor, layer.fillOpacity ?? 0.16);
}

function selectedShapeStroke(shapeType: string, path: ReactNode, selected?: boolean) {
  if (!selected || shapeType === "flower") return null;
  return path;
}

function polarPoint(cx: number, cy: number, radius: number, angleDeg: number) {
  const angle = (angleDeg - 90) * Math.PI / 180;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function annularSectorPath(innerRadius: number, outerRadius: number, startAngle: number, endAngle: number): string {
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const outerStart = polarPoint(50, 50, outerRadius, startAngle);
  const outerEnd = polarPoint(50, 50, outerRadius, endAngle);
  const innerEnd = polarPoint(50, 50, innerRadius, endAngle);
  const innerStart = polarPoint(50, 50, innerRadius, startAngle);

  if (innerRadius <= 0) {
    return [
      `M 50 50`,
      `L ${outerStart.x} ${outerStart.y}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
      "Z",
    ].join(" ");
  }

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function wrapTextLines(text: string | undefined, maxChars: number, maxLines = Number.POSITIVE_INFINITY): string[] {
  if (!text?.trim()) return [];
  const safeMaxChars = Math.max(1, Math.floor(maxChars));
  const sourceLines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const lines: string[] = [];

  for (const sourceLine of sourceLines) {
    const words = sourceLine.split(/\s+/).filter(Boolean);
    let current = "";

    for (const word of words) {
      if (word.length > safeMaxChars) {
        if (current) {
          lines.push(current);
          current = "";
        }
        for (let offset = 0; offset < word.length; offset += safeMaxChars) {
          lines.push(word.slice(offset, offset + safeMaxChars));
        }
        continue;
      }

      const next = current ? `${current} ${word}` : word;
      if (next.length > safeMaxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines.slice(0, Number.isFinite(maxLines) ? maxLines : lines.length);
}

function fitSegmentText(
  text: string | undefined,
  arcLength: number,
  radialBand: number,
  preferredFontSize?: number
): { lines: string[]; fontSize: number } {
  if (!text?.trim()) {
    return { lines: [], fontSize: preferredFontSize ?? Math.max(2.8, Math.min(7.8, radialBand * 0.34)) };
  }

  const preferred = preferredFontSize ?? Math.max(3.2, Math.min(10, radialBand * 0.42));
  const availableWidth = Math.max(2, arcLength * 0.9);
  const availableHeight = Math.max(2, radialBand * 0.84);

  for (let fontSize = preferred; fontSize >= 0.55; fontSize -= 0.15) {
    const charsPerLine = Math.max(1, Math.floor(availableWidth / Math.max(0.36, fontSize * 0.54)));
    const lines = wrapTextLines(text, charsPerLine);
    const longest = Math.max(1, ...lines.map((line) => line.length));
    const widthFits = longest * fontSize * 0.54 <= availableWidth;
    const heightFits = lines.length * fontSize * 1.12 <= availableHeight;
    if (widthFits && heightFits) return { lines, fontSize };
  }

  const fallbackLines = wrapTextLines(text, Math.max(1, Math.floor(availableWidth / 0.35)));
  const longest = Math.max(1, ...fallbackLines.map((line) => line.length));
  const widthFit = availableWidth / (longest * 0.54);
  const heightFit = availableHeight / (Math.max(1, fallbackLines.length) * 1.12);
  return { lines: fallbackLines, fontSize: Math.max(0.35, Math.min(0.55, widthFit, heightFit)) };
}

function fitCenterText(text: string | undefined, radius: number, preferredFontSize?: number): { lines: string[]; fontSize: number } {
  if (!text?.trim() || radius <= 0) {
    return { lines: [], fontSize: preferredFontSize ?? Math.max(3, radius * 0.34) };
  }

  const preferred = preferredFontSize ?? Math.max(3, Math.min(12, radius * 0.38));
  const availableWidth = Math.max(2, radius * 1.62);
  const availableHeight = Math.max(2, radius * 1.55);

  for (let fontSize = preferred; fontSize >= 0.55; fontSize -= 0.15) {
    const charsPerLine = Math.max(1, Math.floor(availableWidth / Math.max(0.36, fontSize * 0.54)));
    const lines = wrapTextLines(text, charsPerLine);
    const longest = Math.max(1, ...lines.map((line) => line.length));
    const widthFits = longest * fontSize * 0.54 <= availableWidth;
    const heightFits = lines.length * fontSize * 1.12 <= availableHeight;
    if (widthFits && heightFits) return { lines, fontSize };
  }

  const fallbackLines = wrapTextLines(text, Math.max(1, Math.floor(availableWidth / 0.35)));
  const longest = Math.max(1, ...fallbackLines.map((line) => line.length));
  const widthFit = availableWidth / (longest * 0.54);
  const heightFit = availableHeight / (Math.max(1, fallbackLines.length) * 1.12);
  return { lines: fallbackLines, fontSize: Math.max(0.35, Math.min(0.55, widthFit, heightFit)) };
}

function chartRingSegments(ring: RadialChartRing): RadialChartSegment[] {
  const count = Math.max(1, Math.min(72, Math.round(ring.segmentCount || 1)));
  const segments = ring.segments ?? [];
  return Array.from({ length: count }, (_, index) => segments[index] ?? { id: `segment-${index + 1}` });
}

type ChartTextEdit =
  | { kind: "segment"; ringIndex: number; segmentIndex: number; x: number; y: number; width: number; rotation: number; value: string }
  | { kind: "center"; x: number; y: number; width: number; rotation: number; value: string };

function updateRadialSegmentText(chart: RadialChartData, ringIndex: number, segmentIndex: number, text: string): RadialChartData {
  const rings = chart.rings ?? [];
  return {
    ...chart,
    rings: rings.map((ring, idx) => {
      if (idx !== ringIndex) return ring;
      const segments = chartRingSegments(ring).map((segment, sIdx) =>
        sIdx === segmentIndex ? { ...segment, text } : segment
      );
      return { ...ring, segments };
    }),
  };
}

function RadialChartLayer({
  chart,
  borderColor,
  editingText,
  onSegmentEdit,
  onCenterEdit,
}: {
  chart?: RadialChartData;
  borderColor: string;
  editingText?: ChartTextEdit | null;
  onSegmentEdit?: (edit: ChartTextEdit & { kind: "segment" }) => void;
  onCenterEdit?: (edit: ChartTextEdit & { kind: "center" }) => void;
}) {
  const rawClipId = useId();
  const clipId = `radial-chart-clip-${rawClipId.replace(/:/g, "")}`;

  if (!chart?.enabled) return null;
  const rings = chart.rings?.length ? chart.rings : [{ id: "ring-1", segmentCount: 6 }];
  const centerRadius = Math.max(0, Math.min(42, chart.centerRadius ?? 14));
  const outerRadius = 49;
  const ringThickness = rings.length ? (outerRadius - centerRadius) / rings.length : 0;
  const rotation = chart.rotation ?? 0;
  const segmentBorderColor = chart.segmentBorderColor ?? borderColor;
  const segmentBorderWidth = Math.max(0, chart.segmentBorderWidth ?? 0.8);
  const centerTextFit = fitCenterText(
    chart.centerText,
    centerRadius,
    chart.centerFontSize && chart.centerFontSize > 0 ? chart.centerFontSize : undefined
  );

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 z-[2] h-full w-full">
      <defs>
        <clipPath id={clipId}>
          <circle cx="50" cy="50" r="49.5" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {rings.map((ring, ringIndex) => {
          const innerRadius = centerRadius + ringThickness * ringIndex;
          const segmentOuterRadius = centerRadius + ringThickness * (ringIndex + 1);
          const segments = chartRingSegments(ring);
          return segments.map((segment, segmentIndex) => {
            const start = rotation + (360 / segments.length) * segmentIndex;
            const end = rotation + (360 / segments.length) * (segmentIndex + 1);
            const mid = (start + end) / 2;
            const textRadius = (innerRadius + segmentOuterRadius) / 2;
            const textPoint = polarPoint(50, 50, textRadius, mid);
            const textRotation = ((mid + 90) % 360 + 360) % 360;
            const readableTextRotation = textRotation > 90 && textRotation < 270 ? textRotation + 180 : textRotation;
            const finalTextRotation = readableTextRotation + (segment.textRotation ?? 0);
            const angleWidth = 360 / segments.length;
            const arcLength = (2 * Math.PI * textRadius * angleWidth) / 360;
            const { lines, fontSize } = fitSegmentText(
              segment.text,
              arcLength,
              ringThickness,
              segment.fontSize && segment.fontSize > 0 ? segment.fontSize : undefined
            );
            const lineOffset = -((lines.length - 1) * fontSize * 1.12) / 2;
            const isEditingSegment =
              editingText?.kind === "segment" &&
              editingText.ringIndex === ringIndex &&
              editingText.segmentIndex === segmentIndex;
            return (
              <g key={`${ring.id}-${segment.id}-${segmentIndex}`}>
                <path
                  d={annularSectorPath(innerRadius, segmentOuterRadius, start, end)}
                  className="nodrag nopan cursor-text"
                  fill={segment.fillColor ?? (ringIndex % 2 ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)")}
                  stroke={segmentBorderWidth > 0 ? segmentBorderColor : "none"}
                  strokeWidth={segmentBorderWidth}
                  pointerEvents="auto"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSegmentEdit?.({
                      kind: "segment",
                      ringIndex,
                      segmentIndex,
                      x: textPoint.x,
                      y: textPoint.y,
                      width: Math.max(110, Math.min(280, arcLength * 4)),
                      rotation: finalTextRotation,
                      value: segment.text ?? "",
                    });
                  }}
                />
                {lines.length > 0 && !isEditingSegment && (
                  <text
                    x={textPoint.x}
                    y={textPoint.y}
                    pointerEvents="none"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={segment.textColor ?? "#111827"}
                    fontSize={fontSize}
                    fontWeight={ringIndex === 0 ? 700 : 500}
                    transform={`rotate(${finalTextRotation} ${textPoint.x} ${textPoint.y})`}
                  >
                    {lines.map((line, lineIndex) => (
                      <tspan key={lineIndex} x={textPoint.x} dy={lineIndex === 0 ? lineOffset : fontSize * 1.12}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                )}
              </g>
            );
          });
        })}
      </g>
      {centerRadius > 0 && (
        <>
          <circle
            cx="50"
            cy="50"
            r={centerRadius}
            className="nodrag nopan cursor-text"
            fill={chart.centerColor ?? "rgba(255,255,255,0.9)"}
            stroke={segmentBorderWidth > 0 ? segmentBorderColor : borderColor}
            strokeWidth={Math.max(0.45, segmentBorderWidth)}
            pointerEvents="auto"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onCenterEdit?.({
                kind: "center",
                x: 50,
                y: 50,
                width: Math.max(72, centerRadius * 4.5),
                rotation: 0,
                value: chart.centerText ?? "",
              });
            }}
          />
          {centerTextFit.lines.length > 0 && editingText?.kind !== "center" && (
            <text
              x="50"
              y="50"
              pointerEvents="none"
              textAnchor="middle"
              dominantBaseline="middle"
              fill={chart.centerTextColor ?? "#111827"}
              fontSize={centerTextFit.fontSize}
              fontWeight="700"
            >
              {centerTextFit.lines.map((line, lineIndex) => (
                <tspan
                  key={lineIndex}
                  x="50"
                  dy={lineIndex === 0 ? -((centerTextFit.lines.length - 1) * centerTextFit.fontSize * 1.12) / 2 : centerTextFit.fontSize * 1.12}
                >
                  {line}
                </tspan>
              ))}
            </text>
          )}
        </>
      )}
    </svg>
  );
}

function SvgShapeSurface({
  shapeType,
  fillColor,
  borderColor,
  borderWidth,
  borderStyle,
  selected,
  petalCount,
}: {
  shapeType: string;
  fillColor?: string;
  borderColor: string;
  borderWidth: number;
  borderStyle: string;
  selected?: boolean;
  petalCount?: number;
}) {
  const strokeWidth = borderWidth > 0 ? borderWidth : 0;
  const stroke = borderWidth > 0 ? borderColor : "none";
  const strokeDasharray = dashArray(borderStyle, Math.max(1, borderWidth));
  const commonStroke = {
    stroke,
    strokeWidth,
    strokeDasharray,
    vectorEffect: "non-scaling-stroke" as const,
    strokeLinejoin: "round" as const,
    strokeLinecap: "round" as const,
  };
  const selectedStroke = {
    fill: "none",
    stroke: "#4262ff",
    strokeWidth: 2,
    strokeDasharray: "4 3",
    vectorEffect: "non-scaling-stroke" as const,
    strokeLinejoin: "round" as const,
    strokeLinecap: "round" as const,
  };

  if (POLYGON_POINTS[shapeType]) {
    const points = POLYGON_POINTS[shapeType];
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <polygon points={points} fill={fillColor ?? "transparent"} {...commonStroke} />
        {selected && <polygon points={points} {...selectedStroke} />}
      </svg>
    );
  }

  const path =
    shapeType === "document" ? "M6 5 H94 V76 C76 66 66 94 46 83 C28 72 18 92 6 80 Z"
    : shapeType === "database" ? "M10 22 C10 8 90 8 90 22 V78 C90 92 10 92 10 78 Z"
    : shapeType === "delay" ? "M8 5 H55 C80 5 96 25 96 50 C96 75 80 95 55 95 H8 Z"
    : shapeType === "cloud" ? "M30 80 H78 C91 80 98 70 94 58 C99 47 91 35 78 36 C73 21 55 15 43 25 C33 18 18 24 17 39 C7 43 2 52 5 64 C8 75 17 80 30 80 Z"
    : shapeType === "leaf" ? "M50 3 C87 18 98 51 50 97 C2 51 13 18 50 3 Z"
    : undefined;

  if (shapeType === "flower") {
    const petals = Array.from({ length: normalizePetalCount(petalCount) }, (_, i) => i);
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        {petals.map((petal) => (
          <ellipse
            key={petal}
            cx="50"
            cy="29"
            rx="15"
            ry="28"
            transform={`rotate(${(360 / petals.length) * petal} 50 50)`}
            fill={fillColor ?? "transparent"}
            {...commonStroke}
          />
        ))}
        <circle
          cx="50"
          cy="50"
          r="15"
          fill={fillColor ?? "transparent"}
          {...commonStroke}
        />
        {selected && <circle cx="50" cy="50" r="47" {...selectedStroke} />}
      </svg>
    );
  }

  if (shapeType === "predefinedProcess") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <rect x="4" y="4" width="92" height="92" rx="6" fill={fillColor ?? "transparent"} {...commonStroke} />
        <line x1="20" y1="4" x2="20" y2="96" {...commonStroke} />
        <line x1="80" y1="4" x2="80" y2="96" {...commonStroke} />
        {selected && <rect x="4" y="4" width="92" height="92" rx="6" {...selectedStroke} />}
      </svg>
    );
  }

  if (shapeType === "database") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <path d={path} fill={fillColor ?? "transparent"} {...commonStroke} />
        <path d="M10 22 C10 36 90 36 90 22" fill="none" {...commonStroke} />
        {selected && <path d={path} {...selectedStroke} />}
      </svg>
    );
  }

  if (path) {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <path d={path} fill={fillColor ?? "transparent"} {...commonStroke} />
        {shapeType === "document" && <path d="M6 80 C18 92 28 72 46 83 C66 94 76 66 94 76" fill="none" {...commonStroke} />}
        {shapeType === "leaf" && <path d="M50 10 C46 32 48 68 50 92" fill="none" {...commonStroke} />}
        {selectedShapeStroke(shapeType, <path d={path} {...selectedStroke} />, selected)}
      </svg>
    );
  }

  return null;
}

function ShapeSurface({
  shapeType,
  fillColor,
  borderColor,
  borderWidth,
  borderStyle,
  borderRadius,
  selected,
  petalCount,
}: {
  shapeType: string;
  fillColor?: string;
  borderColor: string;
  borderWidth: number;
  borderStyle: string;
  borderRadius: number;
  selected?: boolean;
  petalCount?: number;
}) {
  if (isSvgShape(shapeType)) {
    return (
      <SvgShapeSurface
        shapeType={shapeType}
        fillColor={fillColor}
        borderColor={borderColor}
        borderWidth={borderWidth}
        borderStyle={borderStyle}
        selected={selected}
        petalCount={petalCount}
      />
    );
  }

  const shapeStyle: CSSProperties = { borderRadius };
  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          ...shapeStyle,
          backgroundColor: fillColor,
          border: `${borderWidth}px ${borderStyle} ${borderColor}`,
        }}
      />
      {selected && <div className="absolute inset-0 ring-2 ring-primary ring-offset-1" style={shapeStyle} />}
    </>
  );
}

function ShapeNodeComponent({ id, data, selected }: NodeProps) {
  const d  = data as ShapeNodeData;
  const dd = d as Record<string, unknown>;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const fitNodeToContent = useCanvasStore((s) => s.fitNodeToContent);
  const pushHistory    = useCanvasStore((s) => s.pushHistory);
  const createChildNode = useCanvasStore((s) => s.createChildNode);
  const viewport = useViewport();

  const drawingModeNodeId   = useUIStore((s) => s.drawingModeNodeId);
  const drawingRegionColor  = useUIStore((s) => s.drawingRegionColor);
  const drawingRegionOpacity = useUIStore((s) => s.drawingRegionOpacity);
  const isDrawing           = drawingModeNodeId === id;

  const shapeType = (d.shapeType ?? "rounded") as string;
  const svgShape = isSvgShape(shapeType);

  const fillColor    = resolveFillColor(dd);
  const borderColor  = resolveBorderColor(dd) ?? (d.color ?? "#4262ff");
  const bWidth       = resolveBorderWidth(dd);
  const bStyle       = (dd.borderStyle as string) ?? "solid";
  const bRadius      = typeof dd.borderRadius === "number" ? dd.borderRadius : DEFAULT_RADIUS[shapeType] ?? 16;
  const borderLayers = (dd.borderLayers as BorderLayer[]) ?? [];
  const fillOpacity  = resolveFillOpacity(dd);
  const fillRegions  = (dd.internalFillRegions as InternalFillRegion[]) ?? [];
  const petalCount   = normalizePetalCount(d.petalCount);
  const radialChart  = d.radialChart;
  const rotation     = typeof dd.rotation === "number" ? dd.rotation : 0;
  const concentricLayers = useMemo(
    () => (d.concentricLayers ?? []) as ConcentricShapeLayer[],
    [d.concentricLayers]
  );

  const [editing, setEditing] = useState(false);
  const [chartTextEdit, setChartTextEdit] = useState<ChartTextEdit | null>(null);
  const [initialContent] = useState(() => dd.richText as string || (d.text as string) || "");
  const editHistoryCaptured = useRef(false);
  const editDirty = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useNodeContentAutoFit({ nodeId: id, boxRef, contentRef });

  const captureTextHistory = useCallback(() => {
    if (!editHistoryCaptured.current) {
      pushHistory();
      editHistoryCaptured.current = true;
    }
    editDirty.current = true;
  }, [pushHistory]);

  const finishEditing = useCallback(() => {
    if (editDirty.current) {
      pushHistory();
      editDirty.current = false;
    }
    editHistoryCaptured.current = false;
    setEditing(false);
  }, [pushHistory]);

  useEffect(() => {
    if (!selected && editing) {
      const frame = requestAnimationFrame(finishEditing);
      return () => cancelAnimationFrame(frame);
    }
  }, [selected, editing, finishEditing]);

  const shapeStyle: CSSProperties = CLIP_PATHS[shapeType]
    ? { clipPath: CLIP_PATHS[shapeType] }
    : { borderRadius: bRadius };
  const activeChartTextEdit = selected && radialChart?.enabled ? chartTextEdit : null;
  const chartEditorScale = activeChartTextEdit
    ? Math.min(5, Math.max(1, 1 / Math.max(0.2, viewport.zoom)))
    : 1;
  const visualRotationStyle: CSSProperties = {
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
    transformOrigin: "center",
  };

  const addConcentricLayer = useCallback(() => {
    pushHistory();
    const nextLayer: ConcentricShapeLayer = {
      id: generateId(),
      shapeType: shapeType as ShapeType,
      fillColor: "transparent",
      borderColor,
      borderWidth: Math.max(1, bWidth),
      borderStyle: (bStyle as ConcentricShapeLayer["borderStyle"]) ?? "solid",
      text: "",
      textColor: (dd.textColor as string | undefined) ?? "#111827",
      fontSize: typeof dd.fontSize === "number" ? dd.fontSize : 14,
    };
    updateNodeData(id, { concentricLayers: [...concentricLayers, nextLayer] });
  }, [bStyle, bWidth, borderColor, concentricLayers, dd.fontSize, dd.textColor, id, pushHistory, shapeType, updateNodeData]);

  const updateChartEditText = useCallback((value: string) => {
    if (!activeChartTextEdit) return;
    const latest = useCanvasStore.getState().nodes.find((node) => node.id === id)?.data as ShapeNodeData | undefined;
    const chart = latest?.radialChart ?? radialChart;
    if (!chart) return;
    const nextChart = activeChartTextEdit.kind === "center"
      ? { ...chart, centerText: value }
      : updateRadialSegmentText(chart, activeChartTextEdit.ringIndex, activeChartTextEdit.segmentIndex, value);
    setChartTextEdit({ ...activeChartTextEdit, value } as ChartTextEdit);
    updateNodeData(id, { radialChart: nextChart });
  }, [activeChartTextEdit, id, radialChart, updateNodeData]);

  return (
    <>
      <NodeResizer minWidth={60} minHeight={60} isVisible={selected && !editing && !isDrawing}
        keepAspectRatio={SQUARE_ASPECT_SHAPES.has(shapeType)} />

      <div
        ref={boxRef}
        className="group relative flex h-full w-full items-center justify-center"
        onDoubleClick={() => {
          if (isDrawing || radialChart?.enabled) return;
          editHistoryCaptured.current = false;
          editDirty.current = false;
          setEditing(true);
        }}
      >
        <NodeHandles color={borderColor} />
        <NodeQuickActions nodeId={id} color={borderColor} selected={selected} />

        {/* Add connected child */}
        {!isDrawing && (
          <button
            className={cn(
              "absolute -right-3.5 -bottom-3.5 z-20 hidden h-7 w-7 items-center justify-center rounded-full border-2 border-background shadow-md transition-transform hover:scale-110 group-hover:flex"
            )}
            style={{ backgroundColor: borderColor }}
            onClick={(e) => { e.stopPropagation(); createChildNode(id); }}
            title="Add connected node"
          >
            <Plus className="h-3.5 w-3.5 text-white" />
          </button>
        )}
        <div className="absolute inset-0" style={visualRotationStyle}>
          {!svgShape && <BorderLayers layers={borderLayers} primaryWidth={bWidth} baseRadius={bRadius} />}

          <ShapeSurface
            shapeType={shapeType}
            fillColor={fillColor}
            borderColor={borderColor}
            borderWidth={bWidth}
            borderStyle={bStyle}
            borderRadius={bRadius}
            selected={selected}
            petalCount={petalCount}
          />

          {/* Internal fill regions — clipped inside shape */}
          <div className="absolute inset-0 overflow-hidden" style={shapeStyle}>
            <InternalFillLayer
              regions={fillRegions}
              isDrawingMode={isDrawing}
              drawingColor={drawingRegionColor}
              drawingOpacity={drawingRegionOpacity}
              fillOpacity={fillOpacity}
              interactive={selected && !isDrawing}
              onRegionAdded={(r) => updateNodeData(id, { internalFillRegions: [...fillRegions, r] })}
              onRegionUpdated={(rid, patch) => updateNodeData(id, {
                internalFillRegions: fillRegions.map((x) => x.id === rid ? { ...x, ...patch } : x),
              })}
            />
          </div>

          <RadialChartLayer
            chart={radialChart}
            borderColor={borderColor}
            editingText={activeChartTextEdit}
            onSegmentEdit={(edit) => {
              editHistoryCaptured.current = false;
              editDirty.current = false;
              pushHistory();
              setEditing(false);
              setChartTextEdit(edit);
            }}
            onCenterEdit={(edit) => {
              editHistoryCaptured.current = false;
              editDirty.current = false;
              pushHistory();
              setEditing(false);
              setChartTextEdit(edit);
            }}
          />

          {activeChartTextEdit && (
            <textarea
              autoFocus
              aria-label={activeChartTextEdit.kind === "center" ? "Edit chart center text" : "Edit chart segment text"}
              name={activeChartTextEdit.kind === "center" ? "radial-chart-inline-center" : "radial-chart-inline-segment"}
              rows={3}
              className="nodrag nopan absolute z-[40] resize-none rounded-md border border-primary bg-background/95 text-center font-medium shadow-lg outline-none ring-2 ring-primary/20"
              value={activeChartTextEdit.value}
              style={{
                left: `${activeChartTextEdit.x}%`,
                top: `${activeChartTextEdit.y}%`,
                width: Math.max(170, activeChartTextEdit.width) * chartEditorScale,
                minHeight: 64 * chartEditorScale,
                maxHeight: 170 * chartEditorScale,
                padding: `${7 * chartEditorScale}px ${9 * chartEditorScale}px`,
                fontSize: 14 * chartEditorScale,
                lineHeight: `${19 * chartEditorScale}px`,
                transform: `translate(-50%, -50%) rotate(${activeChartTextEdit.rotation}deg)`,
                transformOrigin: "center",
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => updateChartEditText(event.target.value)}
              onBlur={() => setChartTextEdit(null)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
                  event.currentTarget.blur();
                }
              }}
            />
          )}

          {concentricLayers.map((layer, index) => {
            const inset = concentricInset(index, concentricLayers.length);
            const innerShape = layer.shapeType ?? (shapeType as ShapeType);
            return (
              <div
                key={layer.id}
                className="pointer-events-none absolute"
                style={{ inset: `${inset}%` }}
              >
                <ShapeSurface
                  shapeType={innerShape}
                  fillColor={layerFillColor(layer)}
                  borderColor={layer.borderColor ?? borderColor}
                  borderWidth={layer.borderWidth ?? Math.max(1, bWidth)}
                  borderStyle={layer.borderStyle ?? bStyle}
                  borderRadius={Math.max(0, bRadius - inset)}
                  petalCount={petalCount}
                />
                {layer.text && (
                  <div
                    className="absolute inset-x-[12%] top-[8%] z-10 truncate text-center font-medium"
                    style={{
                      color: layer.textColor ?? "#111827",
                      fontSize: layer.fontSize ? `${layer.fontSize}px` : undefined,
                    }}
                  >
                    {layer.text}
                  </div>
                )}
              </div>
            );
          })}

          {!radialChart?.enabled && (
            <div className={cn(
              "nodrag nopan relative z-10 flex h-full w-full items-center justify-center px-3 text-center text-sm font-medium text-foreground",
              editing && "cursor-text"
            )}>
              <div ref={contentRef} className="w-full" style={getTextStyle(dd)}>
                <RichTextEditor
                  initialContent={initialContent}
                  editable={editing}
                  placeholder="Double-click…"
                  className="[&_.ProseMirror]:text-center"
                  blockAlign={dd.textAlign as "left" | "center" | "right" | "justify" | undefined}
                  onChange={(html) => {
                    captureTextHistory();
                    const plain = html.replace(/<[^>]+>/g, "").trim();
                    updateNodeData(id, { richText: html, text: plain });
                  }}
                  onContentSizeChange={(size) => fitNodeToContent(id, size)}
                  onBlur={finishEditing}
                />
              </div>
            </div>
          )}
        </div>

        {selected && !editing && !isDrawing && (
          <button
            className="nodrag nopan absolute -left-3.5 -bottom-3.5 z-30 flex h-7 w-7 items-center justify-center rounded-full border-2 border-background shadow-md transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: borderColor }}
            title="Add concentric inner shape"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              addConcentricLayer();
            }}
          >
            <Layers2 className="h-3.5 w-3.5 text-white" />
          </button>
        )}
      </div>
    </>
  );
}

export const ShapeNode = memo(ShapeNodeComponent);
