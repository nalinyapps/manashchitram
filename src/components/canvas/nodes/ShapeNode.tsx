"use client";

import { memo, useState, useEffect, useRef, useCallback } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { NodeHandles } from "./NodeHandles";
import {
  getTextStyle, resolveFillColor, resolveBorderColor,
  resolveBorderWidth, resolveFillOpacity,
} from "@/lib/style-utils";
import type { ShapeNodeData, InternalFillRegion, BorderLayer } from "@/lib/types";
import { useCanvasStore } from "@/store/canvas-store";
import { useUIStore } from "@/store/ui-store";
import { RichTextEditor } from "../RichTextEditor";
import { InternalFillLayer } from "../InternalFillLayer";
import { BorderLayers } from "../BorderLayers";
import { NodeQuickActions } from "./NodeQuickActions";

const CLIP_PATHS: Partial<Record<string, string>> = {
  triangle: "polygon(50% 0%, 0% 100%, 100% 100%)",
  hexagon:  "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
  star:     "polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)",
  arrow:    "polygon(0% 25%,60% 25%,60% 0%,100% 50%,60% 100%,60% 75%,0% 75%)",
};

// SVG polygon points (in a 0–100 viewBox) matching the clip paths above.
const POLYGON_POINTS: Partial<Record<string, string>> = {
  triangle: "50,1 1,99 99,99",
  hexagon:  "25,1 75,1 99,50 75,99 25,99 1,50",
  star:     "50,1 61,35 98,35 68,57 79,91 50,70 21,91 32,57 2,35 39,35",
  arrow:    "1,25 60,25 60,1 99,50 60,99 60,75 1,75",
};

const DEFAULT_RADIUS: Partial<Record<string, number>> = {
  rectangle: 0, rounded: 16, circle: 9999, diamond: 8, capsule: 9999, callout: 8,
};

function dashArray(style: string, w: number): string | undefined {
  if (style === "dashed") return `${w * 2.5} ${w * 1.5}`;
  if (style === "dotted") return `0.1 ${w * 2}`;
  return undefined;
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
  const isDiamond = shapeType === "diamond";
  const hasClip   = shapeType in CLIP_PATHS;

  const fillColor    = resolveFillColor(dd);
  const borderColor  = resolveBorderColor(dd) ?? (d.color ?? "#4262ff");
  const bWidth       = resolveBorderWidth(dd);
  const bStyle       = (dd.borderStyle as string) ?? "solid";
  const bRadius      = typeof dd.borderRadius === "number" ? dd.borderRadius : DEFAULT_RADIUS[shapeType] ?? 16;
  const borderLayers = (dd.borderLayers as BorderLayer[]) ?? [];
  const fillOpacity  = resolveFillOpacity(dd);
  const fillRegions  = (dd.internalFillRegions as InternalFillRegion[]) ?? [];

  const [editing, setEditing] = useState(false);
  const [initialContent] = useState(() => dd.richText as string || (d.text as string) || "");
  const editHistoryCaptured = useRef(false);
  const editDirty = useRef(false);

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

  const shapeStyle: React.CSSProperties = hasClip
    ? { clipPath: CLIP_PATHS[shapeType] }
    : { borderRadius: bRadius };

  return (
    <>
      <NodeResizer minWidth={60} minHeight={60} isVisible={selected && !editing && !isDrawing}
        keepAspectRatio={shapeType === "circle" || shapeType === "star"} />

      <div
        className={cn("group relative flex h-full w-full items-center justify-center", isDiamond && "rotate-45")}
        onDoubleClick={() => {
          if (isDrawing) return;
          editHistoryCaptured.current = false;
          editDirty.current = false;
          setEditing(true);
        }}
      >
        <NodeHandles color={borderColor} />
        <NodeQuickActions nodeId={id} color={borderColor} selected={selected} counterRotate={isDiamond} />

        {/* Add connected child */}
        {!isDrawing && (
          <button
            className={cn(
              "absolute -right-3.5 -bottom-3.5 z-20 hidden h-7 w-7 items-center justify-center rounded-full border-2 border-background shadow-md transition-transform hover:scale-110 group-hover:flex",
              isDiamond && "-rotate-45"
            )}
            style={{ backgroundColor: borderColor }}
            onClick={(e) => { e.stopPropagation(); createChildNode(id); }}
            title="Add connected node"
          >
            <Plus className="h-3.5 w-3.5 text-white" />
          </button>
        )}
        {hasClip ? (
          /* ── Clip-path shapes rendered as SVG so the border follows the outline ── */
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
          >
            <polygon
              points={POLYGON_POINTS[shapeType]}
              fill={fillColor ?? "transparent"}
              stroke={bWidth > 0 ? borderColor : "none"}
              strokeWidth={bWidth}
              strokeDasharray={dashArray(bStyle, bWidth)}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {selected && (
              <polygon
                points={POLYGON_POINTS[shapeType]}
                fill="none"
                stroke="#4262ff"
                strokeWidth={2}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        ) : (
          <>
            {/* Extra border layers — expand outward, follow radius, not clipped */}
            <BorderLayers layers={borderLayers} primaryWidth={bWidth} baseRadius={bRadius} />

            {/* Shape fill + border */}
            <div className="absolute inset-0" style={{
              ...shapeStyle,
              backgroundColor: fillColor,
              border: `${bWidth}px ${bStyle} ${borderColor}`,
            }} />

            {selected && <div className="absolute inset-0 ring-2 ring-primary ring-offset-1" style={shapeStyle} />}
          </>
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
          isDiamond && "-rotate-45",
          editing && "cursor-text"
        )}
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
