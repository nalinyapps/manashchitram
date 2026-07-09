"use client";

import { memo, useState, useEffect, useRef, useCallback, useMemo, type CSSProperties, type ReactNode } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
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
const MAX_CONCENTRIC_LAYERS = 6;

function dashArray(style: string, w: number): string | undefined {
  if (style === "dashed") return `${w * 2.5} ${w * 1.5}`;
  if (style === "dotted") return `0.1 ${w * 2}`;
  return undefined;
}

function isSvgShape(shapeType: string): boolean {
  return shapeType in POLYGON_POINTS || CUSTOM_SVG_SHAPES.has(shapeType);
}

function concentricInset(index: number): number {
  return Math.min(44, 10 + index * 7);
}

function normalizePetalCount(value: unknown): number {
  return Math.max(4, Math.min(16, Math.round(typeof value === "number" ? value : 8)));
}

function layerFillColor(layer: ConcentricShapeLayer): string | undefined {
  if (!layer.fillColor || layer.fillColor === "transparent") return "transparent";
  return colorWithOpacity(layer.fillColor, 0.16);
}

function selectedShapeStroke(shapeType: string, path: ReactNode, selected?: boolean) {
  if (!selected || shapeType === "flower") return null;
  return path;
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
  const concentricLayers = useMemo(
    () => (d.concentricLayers ?? []) as ConcentricShapeLayer[],
    [d.concentricLayers]
  );

  const [editing, setEditing] = useState(false);
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

  const addConcentricLayer = useCallback(() => {
    if (concentricLayers.length >= MAX_CONCENTRIC_LAYERS) return;
    pushHistory();
    const nextLayer: ConcentricShapeLayer = {
      id: generateId(),
      shapeType: shapeType as ShapeType,
      inset: concentricInset(concentricLayers.length),
      fillColor: "transparent",
      borderColor,
      borderWidth: Math.max(1, bWidth),
      borderStyle: (bStyle as ConcentricShapeLayer["borderStyle"]) ?? "solid",
    };
    updateNodeData(id, { concentricLayers: [...concentricLayers, nextLayer] });
  }, [bStyle, bWidth, borderColor, concentricLayers, id, pushHistory, shapeType, updateNodeData]);

  return (
    <>
      <NodeResizer minWidth={60} minHeight={60} isVisible={selected && !editing && !isDrawing}
        keepAspectRatio={SQUARE_ASPECT_SHAPES.has(shapeType)} />

      <div
        ref={boxRef}
        className="group relative flex h-full w-full items-center justify-center"
        onDoubleClick={() => {
          if (isDrawing) return;
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

        {concentricLayers.map((layer, index) => {
          const inset = layer.inset ?? concentricInset(index);
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
            </div>
          );
        })}

        {selected && !editing && !isDrawing && (
          <button
            className="nodrag nopan absolute -left-3.5 -bottom-3.5 z-30 flex h-7 w-7 items-center justify-center rounded-full border-2 border-background shadow-md transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: borderColor }}
            title="Add concentric inner shape"
            disabled={concentricLayers.length >= MAX_CONCENTRIC_LAYERS}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              addConcentricLayer();
            }}
          >
            <Layers2 className="h-3.5 w-3.5 text-white" />
          </button>
        )}

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

        {/* Text */}
        <div className={cn(
          "nodrag nopan relative z-10 w-full px-3 text-center text-sm font-medium text-foreground",
          editing && "cursor-text"
        )}
          ref={contentRef}
          style={getTextStyle(dd)}>
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
    </>
  );
}

export const ShapeNode = memo(ShapeNodeComponent);
