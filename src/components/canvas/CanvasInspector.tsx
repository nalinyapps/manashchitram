"use client";

import { useState } from "react";
import {
  Trash2, ChevronDown, ChevronRight, Lock, Unlock,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Bold, Italic, Plus, Minus, Pencil, StopCircle, Copy,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useCanvasStore } from "@/store/canvas-store";
import { useUIStore } from "@/store/ui-store";
import { SANSKRIT_TAG_SUGGESTIONS } from "@/lib/types";
import type {
  BorderLayer,
  ConcentricShapeLayer,
  InternalFillRegion,
  RadialChartData,
  RadialChartRing,
  RadialChartSegment,
  ShapeType,
} from "@/lib/types";
import type { Node } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { ColorSwatchPicker } from "./ColorSwatchPicker";
import { FONT_OPTIONS, groupFontsByCategory } from "@/lib/fonts";
import { generateId } from "@/lib/utils";

// ── Constants ──────────────────────────────────────────────────────────────

const SHAPE_TYPES = [
  { label: "Rounded",    value: "rounded"   },
  { label: "Rectangle",  value: "rectangle" },
  { label: "Circle",     value: "circle"    },
  { label: "Diamond",    value: "diamond"   },
  { label: "Capsule",    value: "capsule"   },
  { label: "Data",       value: "parallelogram" },
  { label: "Manual",     value: "trapezoid" },
  { label: "Document",   value: "document" },
  { label: "Database",   value: "database" },
  { label: "Predef.",    value: "predefinedProcess" },
  { label: "Delay",      value: "delay" },
  { label: "Cloud",      value: "cloud" },
  { label: "Off-page",   value: "offPageConnector" },
  { label: "Triangle",   value: "triangle"  },
  { label: "Hexagon",    value: "hexagon"   },
  { label: "Star",       value: "star"      },
  { label: "Arrow",      value: "arrow"     },
  { label: "Flower",     value: "flower"    },
  { label: "Leaf",       value: "leaf"      },
  { label: "Callout",    value: "callout"   },
];

const CONCENTRIC_INSET_STEP = 6;
const RADIAL_SEGMENT_COLORS = [
  "#c7d2fe", "#bfdbfe", "#a7f3d0", "#fde68a", "#fecaca", "#fbcfe8",
  "#ddd6fe", "#bae6fd", "#d9f99d", "#fed7aa", "#ccfbf1", "#e9d5ff",
];
const RADIAL_CHART_MIN_SIZE = 420;

function concentricInset(index: number, total: number): number {
  const step = Math.min(CONCENTRIC_INSET_STEP, 48 / Math.max(1, total + 1));
  return step * (index + 1);
}

function hexInputColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function normalizeRadialSegments(ring: RadialChartRing, count = ring.segmentCount): RadialChartSegment[] {
  const safeCount = Math.max(1, Math.min(72, Math.round(count || 1)));
  const existing = ring.segments ?? [];
  return Array.from({ length: safeCount }, (_, index) => existing[index] ?? {
    id: generateId(),
    text: "",
    fillColor: RADIAL_SEGMENT_COLORS[index % RADIAL_SEGMENT_COLORS.length],
    textColor: "#111827",
  });
}

function createDefaultRadialChart(centerText = ""): RadialChartData {
  const innerRing: RadialChartRing = { id: generateId(), segmentCount: 4 };
  const outerRing: RadialChartRing = { id: generateId(), segmentCount: 12 };
  return {
    enabled: true,
    rotation: 0,
    segmentBorderColor: "#ffffff",
    segmentBorderWidth: 0.8,
    centerText,
    centerColor: "#ffffff",
    centerTextColor: "#111827",
    centerRadius: 14,
    rings: [
      { ...innerRing, segments: normalizeRadialSegments(innerRing) },
      { ...outerRing, segments: normalizeRadialSegments(outerRing) },
    ],
  };
}

function normalizeRadialChart(chart: RadialChartData | undefined, centerText = ""): RadialChartData {
  if (!chart?.rings?.length) return createDefaultRadialChart(centerText);
  return {
    ...chart,
    enabled: chart.enabled ?? true,
    rotation: chart.rotation ?? 0,
    segmentBorderColor: chart.segmentBorderColor ?? "#ffffff",
    segmentBorderWidth: chart.segmentBorderWidth ?? 0.8,
    centerRadius: chart.centerRadius ?? 14,
    centerText: chart.centerText ?? centerText,
    centerColor: chart.centerColor ?? "#ffffff",
    centerTextColor: chart.centerTextColor ?? "#111827",
    centerFontSize: chart.centerFontSize && chart.centerFontSize > 0 ? chart.centerFontSize : undefined,
    rings: chart.rings.map((ring) => ({
      ...ring,
      segmentCount: Math.max(1, Math.min(72, Math.round(ring.segmentCount || 1))),
      segments: normalizeRadialSegments(ring),
    })),
  };
}

const CONVERT_TYPES = [
  { label: "Mind-map",  value: "mindmap" },
  { label: "Text box",  value: "text"    },
  { label: "Sticky",    value: "sticky"  },
  { label: "Shape",     value: "shape"   },
];

// ── Section wrapper ────────────────────────────────────────────────────────

function Section({ label, children, defaultOpen = true }: {
  label: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
        {label}
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && <div className="space-y-2.5 px-3 pb-3">{children}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

function IconBtn({ active, onClick, title, children }: {
  active?: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button title={title} onClick={onClick}
      className={cn("flex h-7 w-7 items-center justify-center rounded-md border text-xs transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted text-foreground")}>
      {children}
    </button>
  );
}

function clampControlValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function SliderControl({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix = "",
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const apply = (next: number) => onChange(clampControlValue(next, min, max));
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => apply(value - step)}
        className="flex h-6 w-6 items-center justify-center rounded border border-border hover:bg-muted text-xs"><Minus className="h-3 w-3" /></button>
      <input
        aria-label="Adjust value"
        name="slider-control"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => apply(Number(e.target.value))}
        className="flex-1 h-1.5 accent-primary"
      />
      <button onClick={() => apply(value + step)}
        className="flex h-6 w-6 items-center justify-center rounded border border-border hover:bg-muted text-xs"><Plus className="h-3 w-3" /></button>
      <span className="w-9 text-center text-[10px] text-muted-foreground">{value}{suffix}</span>
    </div>
  );
}

/** Thickness control: slider + −/+ buttons */
function ThicknessControl({ value, onChange, max = 20 }: {
  value: number; onChange: (v: number) => void; max?: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => onChange(Math.max(0, value - 1))}
        className="flex h-6 w-6 items-center justify-center rounded border border-border hover:bg-muted text-xs"><Minus className="h-3 w-3" /></button>
      <input type="range" min={0} max={max} step={1} value={value}
        aria-label="Adjust thickness"
        name="thickness-control"
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1.5 accent-primary" />
      <button onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-6 w-6 items-center justify-center rounded border border-border hover:bg-muted text-xs"><Plus className="h-3 w-3" /></button>
      <span className="w-7 text-center text-[10px] text-muted-foreground">{value}px</span>
    </div>
  );
}

function supportsCornerRadius(node: Node): boolean {
  const nodeType = node.type ?? "";
  if (["mindmap", "sticky", "text"].includes(nodeType)) return true;
  if (nodeType !== "shape") return false;
  const shapeType = ((node.data as Record<string, unknown>).shapeType as string | undefined) ?? "";
  return ["rounded", "rectangle"].includes(shapeType);
}

/** Border style selector: Solid | Dashed | Dotted */
function BorderStylePicker({ value, onChange }: {
  value?: string; onChange: (v: "solid" | "dashed" | "dotted") => void;
}) {
  return (
    <div className="flex gap-1">
      {(["solid", "dashed", "dotted"] as const).map((s) => (
        <button key={s} onClick={() => onChange(s)}
          className={cn("rounded border px-2 py-0.5 text-[10px] capitalize flex-1 hover:bg-muted",
            (value ?? "solid") === s ? "border-primary bg-primary/10 text-primary" : "border-border")}>
          {s}
        </button>
      ))}
    </div>
  );
}

// ── Main inspector ─────────────────────────────────────────────────────────

export function CanvasInspector({ compact = false }: { compact?: boolean }) {
  const nodes           = useCanvasStore((s) => s.nodes);
  const edges           = useCanvasStore((s) => s.edges);
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useCanvasStore((s) => s.selectedEdgeIds);
  const settings        = useCanvasStore((s) => s.settings);
  const setSettings     = useCanvasStore((s) => s.setSettings);
  const updateNodeData  = useCanvasStore((s) => s.updateNodeData);
  const resizeNodeToFitBounds = useCanvasStore((s) => s.resizeNodeToFitBounds);
  const deleteSelected  = useCanvasStore((s) => s.deleteSelected);
  const duplicateSelected = useCanvasStore((s) => s.duplicateSelected);
  const pushHistory     = useCanvasStore((s) => s.pushHistory);
  const convertNode     = useCanvasStore((s) => s.convertNode);

  const drawingModeNodeId  = useUIStore((s) => s.drawingModeNodeId);
  const setDrawingModeNodeId = useUIStore((s) => s.setDrawingModeNodeId);
  const drawingRegionColor = useUIStore((s) => s.drawingRegionColor);
  const setDrawingRegionColor = useUIStore((s) => s.setDrawingRegionColor);
  const drawingRegionOpacity = useUIStore((s) => s.drawingRegionOpacity);
  const setDrawingRegionOpacity = useUIStore((s) => s.setDrawingRegionOpacity);

  const selectedNodes = selectedNodeIds.length
    ? nodes.filter((n) => selectedNodeIds.includes(n.id))
    : [];
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const selectedEdges = edges.filter((edge) => selectedEdgeIds.includes(edge.id));

  // ALL hooks before any early return
  const d = (selectedNode?.data ?? {}) as Record<string, unknown>;

  const setField = (key: string, value: unknown) => {
    if (!selectedNode) return;
    pushHistory();
    updateNodeData(selectedNode.id, { [key]: value });
  };

  const commonValue = (key: string) => {
    if (!selectedNodes.length) return undefined;
    const first = (selectedNodes[0].data as Record<string, unknown>)[key];
    return selectedNodes.every((node) => (node.data as Record<string, unknown>)[key] === first)
      ? first
      : undefined;
  };

  const setSelectedField = (key: string, value: unknown) => {
    if (!selectedNodes.length) return;
    pushHistory();
    for (const node of selectedNodes) updateNodeData(node.id, { [key]: value });
  };

  if (selectedNodes.length > 1) {
    const commonFontSize = typeof commonValue("fontSize") === "number" ? commonValue("fontSize") as number : 14;
    const commonFillOpacity = typeof commonValue("fillOpacity") === "number" ? commonValue("fillOpacity") as number : 0.18;
    const commonBorderWidth = typeof commonValue("borderWidth") === "number" ? commonValue("borderWidth") as number : 2;
    const commonBorderStyle = typeof commonValue("borderStyle") === "string" ? commonValue("borderStyle") as string : "solid";
    const radiusNodes = selectedNodes.filter(supportsCornerRadius);
    const firstRadius = radiusNodes.length
      ? (radiusNodes[0].data as Record<string, unknown>).borderRadius
      : undefined;
    const commonBorderRadius = typeof firstRadius === "number" && radiusNodes.every((node) =>
      (node.data as Record<string, unknown>).borderRadius === firstRadius
    ) ? firstRadius : 16;
    const setSelectedRadius = (value: number) => {
      if (!radiusNodes.length) return;
      pushHistory();
      for (const node of radiusNodes) updateNodeData(node.id, { borderRadius: value });
    };

    return (
      <aside className="vidya-float-panel canvas-inspector-panel flex w-64 flex-col">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Selection</h3>
            <p className="text-[10px] text-muted-foreground">{selectedNodes.length} objects</p>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicate" onClick={duplicateSelected}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" title="Delete" onClick={deleteSelected}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex-1 divide-y overflow-y-auto">
          <Section label="Text">
            <Row label="Align">
              {([
                ["left",    <AlignLeft    key="l" className="h-3.5 w-3.5" />, "Left"],
                ["center",  <AlignCenter  key="c" className="h-3.5 w-3.5" />, "Center"],
                ["right",   <AlignRight   key="r" className="h-3.5 w-3.5" />, "Right"],
                ["justify", <AlignJustify key="j" className="h-3.5 w-3.5" />, "Justify"],
              ] as [string, React.ReactNode, string][]).map(([val, icon, title]) => (
                <IconBtn key={val} active={commonValue("textAlign") === val} onClick={() => setSelectedField("textAlign", val)} title={title}>{icon}</IconBtn>
              ))}
            </Row>
            <Row label="Style">
              <IconBtn
                active={commonValue("fontWeight") === "bold"}
                onClick={() => setSelectedField("fontWeight", commonValue("fontWeight") === "bold" ? "normal" : "bold")}
                title="Bold"
              >
                <Bold className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn
                active={commonValue("fontStyle") === "italic"}
                onClick={() => setSelectedField("fontStyle", commonValue("fontStyle") === "italic" ? "normal" : "italic")}
                title="Italic"
              >
                <Italic className="h-3.5 w-3.5" />
              </IconBtn>
            </Row>
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Size</p>
              <ThicknessControl value={commonFontSize} onChange={(v) => setSelectedField("fontSize", v)} max={96} />
            </div>
            <div>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Text color</p>
              <ColorSwatchPicker value={(commonValue("textColor") as string) ?? ""} onChange={(v) => setSelectedField("textColor", v || undefined)} size="sm" />
            </div>
          </Section>

          <Section label="Fill">
            <ColorSwatchPicker
              value={(commonValue("fillColor") as string) ?? ""}
              onChange={(v) => setSelectedField("fillColor", v || undefined)}
            />
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Opacity</p>
              </div>
              <SliderControl
                value={Math.round(commonFillOpacity * 100)}
                onChange={(value) => setSelectedField("fillOpacity", value / 100)}
                suffix="%"
              />
            </div>
          </Section>

          <Section label="Border">
            <div>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Color</p>
              <ColorSwatchPicker value={(commonValue("borderColor") as string) ?? ""} onChange={(v) => setSelectedField("borderColor", v || undefined)} />
            </div>
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Thickness</p>
              <ThicknessControl value={commonBorderWidth} onChange={(v) => setSelectedField("borderWidth", v)} />
            </div>
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Style</p>
              <BorderStylePicker value={commonBorderStyle} onChange={(v) => setSelectedField("borderStyle", v)} />
            </div>
            {radiusNodes.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Corner radius</p>
                <SliderControl value={commonBorderRadius} onChange={setSelectedRadius} suffix="px" />
              </div>
            )}
          </Section>
        </div>
      </aside>
    );
  }

  // ── No selection ──────────────────────────────────────────────────────────
  if (!selectedNode) {
    if (selectedEdges.length) {
      return (
        <aside className="vidya-float-panel canvas-inspector-panel flex w-64 flex-col">
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Connection</h3>
              <p className="text-[10px] text-muted-foreground">
                {selectedEdges.length === 1 ? selectedEdges[0].id.slice(0, 8) : `${selectedEdges.length} selected`}
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={deleteSelected}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          {selectedEdges.length === 1 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              {selectedEdges[0].source} → {selectedEdges[0].target}
            </div>
          )}
        </aside>
      );
    }

    if (compact) return null;

    return (
      <aside className="vidya-float-panel canvas-inspector-panel flex w-64 flex-col">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Canvas</h3>
          <p className="text-xs text-muted-foreground">{nodes.length} nodes · {edges.length} edges</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Section label="Background">
            <Select value={settings.background} onValueChange={(v) => setSettings({ background: v as "dots" | "grid" | "plain" })}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="dots">Dots</SelectItem>
                <SelectItem value="grid">Grid</SelectItem>
                <SelectItem value="plain">Plain</SelectItem>
              </SelectContent>
            </Select>
          </Section>
          <Separator />
          <Section label="Behavior">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Snap to grid</Label>
              <Switch checked={settings.snapToGrid} onCheckedChange={(v) => setSettings({ snapToGrid: v })} />
            </div>
          </Section>
          <Separator />
          <Section label="Script">
            <Select value={settings.defaultScriptMode} onValueChange={(v) => setSettings({ defaultScriptMode: v as typeof settings.defaultScriptMode })}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="plain">Plain</SelectItem>
                <SelectItem value="devanagari">Devanāgarī</SelectItem>
                <SelectItem value="iast">IAST</SelectItem>
                <SelectItem value="mixed">Mixed</SelectItem>
              </SelectContent>
            </Select>
          </Section>
        </div>
      </aside>
    );
  }

  // ── Node selected ──────────────────────────────────────────────────────────
  const nodeType      = selectedNode.type ?? "";
  const isTextNode    = ["mindmap", "sticky", "text"].includes(nodeType);
  const isShapeNode   = nodeType === "shape";
  const isContentNode = isTextNode || isShapeNode;
  const isSanskrit    = ["sanskrit", "shloka", "grammar"].includes(nodeType);

  const borderWidth   = typeof d.borderWidth   === "number" ? d.borderWidth   : 2;
  const borderRadius  = typeof d.borderRadius  === "number" ? d.borderRadius  : 16;
  // Corner-radius only makes sense for rectangular-ish shapes.
  const shapeType     = (d.shapeType as string) ?? "";
  const supportsRadius = isTextNode || (isShapeNode && ["rounded", "rectangle"].includes(shapeType));
  const borderLayers  = (d.borderLayers as BorderLayer[]) ?? [];
  const fillRegions   = (d.internalFillRegions as InternalFillRegion[]) ?? [];
  const concentricLayers = (d.concentricLayers as ConcentricShapeLayer[]) ?? [];
  const radialChart = d.radialChart as RadialChartData | undefined;
  const activeRadialChart = normalizeRadialChart(radialChart, (d.text as string | undefined) ?? "");
  const isDrawing     = drawingModeNodeId === selectedNode.id;
  const fontGroups    = groupFontsByCategory(FONT_OPTIONS);
  const setRadialChart = (chart: RadialChartData) => setField("radialChart", chart);
  const enableRadialChart = (chart: RadialChartData) => {
    setRadialChart({ ...chart, enabled: true });
    resizeNodeToFitBounds(selectedNode.id, {
      width: RADIAL_CHART_MIN_SIZE,
      height: RADIAL_CHART_MIN_SIZE,
    });
  };
  const updateRadialRing = (ringIndex: number, patch: Partial<RadialChartRing>) => {
    const rings = activeRadialChart.rings ?? [];
    const nextRings = rings.map((ring, idx) => {
      if (idx !== ringIndex) return ring;
      const nextCount = patch.segmentCount ?? ring.segmentCount;
      const nextRing = { ...ring, ...patch, segmentCount: nextCount };
      return { ...nextRing, segments: normalizeRadialSegments(nextRing, nextCount) };
    });
    setRadialChart({ ...activeRadialChart, rings: nextRings, enabled: true });
  };
  const updateRadialSegment = (ringIndex: number, segmentIndex: number, patch: Partial<RadialChartSegment>) => {
    const rings = activeRadialChart.rings ?? [];
    const nextRings = rings.map((ring, idx) => {
      if (idx !== ringIndex) return ring;
      const segments = normalizeRadialSegments(ring).map((segment, sIdx) =>
        sIdx === segmentIndex ? { ...segment, ...patch } : segment
      );
      return { ...ring, segments };
    });
    setRadialChart({ ...activeRadialChart, rings: nextRings, enabled: true });
  };

  return (
    <aside className="vidya-float-panel canvas-inspector-panel flex w-64 flex-col">
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <div>
          <h3 className="text-sm font-semibold capitalize">{nodeType}</h3>
          <p className="text-[10px] text-muted-foreground">{selectedNode.id.slice(0, 8)}…</p>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" title={d.locked ? "Unlock" : "Lock"}
            onClick={() => setField("locked", !d.locked)}>
            {d.locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={deleteSelected}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 divide-y overflow-y-auto">

        {/* ── Text ── */}
        {isContentNode && (
          <Section label="Text">
            {/* Alignment */}
            <Row label="Align">
              {([
                ["left",    <AlignLeft    key="l" className="h-3.5 w-3.5" />, "Left"],
                ["center",  <AlignCenter  key="c" className="h-3.5 w-3.5" />, "Center"],
                ["right",   <AlignRight   key="r" className="h-3.5 w-3.5" />, "Right"],
                ["justify", <AlignJustify key="j" className="h-3.5 w-3.5" />, "Justify"],
              ] as [string, React.ReactNode, string][]).map(([val, icon, title]) => (
                <IconBtn key={val} active={d.textAlign === val} onClick={() => setField("textAlign", val)} title={title}>{icon}</IconBtn>
              ))}
            </Row>

            {/* Bold / Italic */}
            <Row label="Style">
              <IconBtn active={d.fontWeight === "bold"}
                onClick={() => setField("fontWeight", d.fontWeight === "bold" ? "normal" : "bold")} title="Bold (whole object)">
                <Bold className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn active={d.fontStyle === "italic"}
                onClick={() => setField("fontStyle", d.fontStyle === "italic" ? "normal" : "italic")} title="Italic (whole object)">
                <Italic className="h-3.5 w-3.5" />
              </IconBtn>
              <span className="ml-1 text-[9px] text-muted-foreground">whole box</span>
            </Row>

            {/* Font size */}
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Size</p>
              <ThicknessControl
                value={(d.fontSize as number) ?? 14}
                onChange={(v) => setField("fontSize", v)}
                max={96}
              />
            </div>

            {/* Font family */}
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Font family</p>
              <Select value={(d.fontFamily as string) ?? ""} onValueChange={(v) => setField("fontFamily", v || undefined)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Default" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="">Default</SelectItem>
                  {[...fontGroups.entries()].map(([cat, fonts]) => (
                    <div key={cat}>
                      <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted">{cat}</div>
                      {fonts.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          <span style={{ fontFamily: f.value }}>{f.label}</span>
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Text color */}
            <div>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Text color</p>
              <ColorSwatchPicker value={(d.textColor as string) ?? ""} onChange={(v) => setField("textColor", v || undefined)} size="sm" />
            </div>
          </Section>
        )}

        {/* ── Fill ── */}
        {isContentNode && (
          <Section label="Fill">
            <ColorSwatchPicker
              value={(d.fillColor as string) ?? ""}
              onChange={(v) => setField("fillColor", v || undefined)}
            />
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Opacity</p>
              </div>
              <SliderControl
                value={Math.round((typeof d.fillOpacity === "number" ? d.fillOpacity : 0.18) * 100)}
                onChange={(value) => setField("fillOpacity", value / 100)}
                suffix="%"
              />
            </div>
          </Section>
        )}

        {/* ── Shape type (only for shape nodes) ── */}
        {isShapeNode && (
          <Section label="Shape type">
            <div className="grid grid-cols-3 gap-1">
              {SHAPE_TYPES.map(({ label, value }) => (
                <button key={value}
                  onClick={() => {
                    // Reset borderRadius so DEFAULT_RADIUS kicks in for the new shape
                    pushHistory();
                    updateNodeData(selectedNode.id, {
                      shapeType: value,
                      borderRadius: undefined,
                      ...(value === "flower" && { petalCount: (d.petalCount as number | undefined) ?? 8 }),
                    });
                  }}
                  className={cn("rounded-lg border px-1 py-1.5 text-[10px] text-center hover:bg-muted",
                    d.shapeType === value ? "border-primary bg-primary/10 text-primary font-medium" : "border-border")}>
                  {label}
                </button>
              ))}
            </div>
            {shapeType === "flower" && (
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Petals</p>
                <SliderControl
                  value={typeof d.petalCount === "number" ? d.petalCount : 8}
                  min={4}
                  max={16}
                  step={1}
                  onChange={(value) => setField("petalCount", value)}
                />
              </div>
            )}
          </Section>
        )}

        {isShapeNode && (
          <Section label="Transform" defaultOpen={false}>
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Rotation</p>
              <SliderControl
                value={typeof d.rotation === "number" ? d.rotation : 0}
                min={-180}
                max={180}
                step={1}
                suffix="deg"
                onChange={(value) => setField("rotation", value)}
              />
            </div>
          </Section>
        )}

        {isShapeNode && (
          <Section label="Concentric" defaultOpen={false}>
            <div className="flex items-center justify-between rounded-lg border border-border px-2 py-1.5">
              <span className="text-[10px] text-muted-foreground">{concentricLayers.length} inner shapes</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  const nextLayer: ConcentricShapeLayer = {
                    id: generateId(),
                    shapeType: ((shapeType || "rounded") as ShapeType),
                    fillColor: "transparent",
                    fillOpacity: 0.16,
                    borderColor: (d.borderColor as string) ?? (d.color as string) ?? "#4262ff",
                    borderWidth: borderWidth || 2,
                    borderStyle: (d.borderStyle as ConcentricShapeLayer["borderStyle"]) ?? "solid",
                    text: "",
                    textColor: (d.textColor as string) ?? "#111827",
                    fontSize: (d.fontSize as number) ?? 14,
                  };
                  setField("concentricLayers", [...concentricLayers, nextLayer]);
                }}
              >
                <Plus className="mr-1 h-3 w-3" /> Add
              </Button>
            </div>
            {concentricLayers.length > 0 && (
              <div className="space-y-2">
                {concentricLayers.map((layer, index) => (
                  <div key={layer.id} className="rounded-lg border border-border p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">
                        Ring {index + 1} · inset {Math.round(concentricInset(index, concentricLayers.length) * 10) / 10}%
                      </span>
                      <button
                        className="text-[10px] text-destructive hover:underline"
                        onClick={() => setField("concentricLayers", concentricLayers.filter((_, idx) => idx !== index))}
                      >
                        Remove
                      </button>
                    </div>
                    <Input
                      aria-label={`Concentric ring ${index + 1} text`}
                      name={`concentric-ring-${index + 1}-text`}
                      value={layer.text ?? ""}
                      placeholder="Ring text..."
                      className="h-8 text-xs"
                      onChange={(event) => setField("concentricLayers", concentricLayers.map((item, idx) =>
                        idx === index ? { ...item, text: event.target.value } : item
                      ))}
                    />
                    <div className="grid grid-cols-3 gap-1.5">
                      <label className="space-y-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                        Fill
                        <input
                          aria-label={`Concentric ring ${index + 1} fill color`}
                          name={`concentric-ring-${index + 1}-fill`}
                          type="color"
                          value={hexInputColor(layer.fillColor, "#ffffff")}
                          onChange={(event) => setField("concentricLayers", concentricLayers.map((item, idx) =>
                            idx === index ? { ...item, fillColor: event.target.value } : item
                          ))}
                          className="h-7 w-full rounded border border-border bg-background"
                        />
                      </label>
                      <label className="space-y-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                        Border
                        <input
                          aria-label={`Concentric ring ${index + 1} border color`}
                          name={`concentric-ring-${index + 1}-border`}
                          type="color"
                          value={hexInputColor(layer.borderColor, "#4262ff")}
                          onChange={(event) => setField("concentricLayers", concentricLayers.map((item, idx) =>
                            idx === index ? { ...item, borderColor: event.target.value } : item
                          ))}
                          className="h-7 w-full rounded border border-border bg-background"
                        />
                      </label>
                      <label className="space-y-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                        Text
                        <input
                          aria-label={`Concentric ring ${index + 1} text color`}
                          name={`concentric-ring-${index + 1}-text-color`}
                          type="color"
                          value={hexInputColor(layer.textColor, "#111827")}
                          onChange={(event) => setField("concentricLayers", concentricLayers.map((item, idx) =>
                            idx === index ? { ...item, textColor: event.target.value } : item
                          ))}
                          className="h-7 w-full rounded border border-border bg-background"
                        />
                      </label>
                    </div>
                    <div>
                      <p className="mb-1 text-[9px] text-muted-foreground">Text size</p>
                      <SliderControl
                        value={layer.fontSize ?? 14}
                        min={8}
                        max={48}
                        step={1}
                        suffix="px"
                        onChange={(value) => setField("concentricLayers", concentricLayers.map((item, idx) =>
                          idx === index ? { ...item, fontSize: value } : item
                        ))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {isShapeNode && (
          <Section label="Split chart" defaultOpen={false}>
            <div className="flex items-center justify-between rounded-lg border border-border px-2 py-1.5">
              <Label className="text-xs">Radial split</Label>
              <Switch
                checked={!!radialChart?.enabled}
                onCheckedChange={(checked) => {
                  if (checked) enableRadialChart(activeRadialChart);
                  else setRadialChart({ ...(radialChart ?? activeRadialChart), enabled: false });
                }}
              />
            </div>

            {radialChart?.enabled && (
              <div className="space-y-2">
                <div className="rounded-lg border border-border p-2 space-y-2">
                  <Input
                    aria-label="Radial chart center text"
                    name="radial-chart-center-text"
                    value={activeRadialChart.centerText ?? ""}
                    placeholder="Center text..."
                    className="h-8 text-xs"
                    onChange={(event) => setRadialChart({ ...activeRadialChart, centerText: event.target.value, enabled: true })}
                  />
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="space-y-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                      Center fill
                      <input
                        aria-label="Radial chart center fill color"
                        name="radial-chart-center-fill"
                        type="color"
                        value={hexInputColor(activeRadialChart.centerColor, "#ffffff")}
                        onChange={(event) => setRadialChart({ ...activeRadialChart, centerColor: event.target.value, enabled: true })}
                        className="h-7 w-full rounded border border-border bg-background"
                      />
                    </label>
                    <label className="space-y-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                      Text
                      <input
                        aria-label="Radial chart center text color"
                        name="radial-chart-center-text-color"
                        type="color"
                        value={hexInputColor(activeRadialChart.centerTextColor, "#111827")}
                        onChange={(event) => setRadialChart({ ...activeRadialChart, centerTextColor: event.target.value, enabled: true })}
                        className="h-7 w-full rounded border border-border bg-background"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="space-y-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                      Split border
                      <input
                        aria-label="Radial chart split border color"
                        name="radial-chart-split-border-color"
                        type="color"
                        value={hexInputColor(activeRadialChart.segmentBorderColor, "#ffffff")}
                        onChange={(event) => setRadialChart({ ...activeRadialChart, segmentBorderColor: event.target.value, enabled: true })}
                        className="h-7 w-full rounded border border-border bg-background"
                      />
                    </label>
                    <div>
                      <p className="mb-1 text-[9px] uppercase tracking-wider text-muted-foreground">Border size</p>
                      <SliderControl
                        value={activeRadialChart.segmentBorderWidth ?? 0.8}
                        min={0}
                        max={20}
                        step={0.2}
                        onChange={(value) => setRadialChart({ ...activeRadialChart, segmentBorderWidth: value, enabled: true })}
                      />
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[9px] text-muted-foreground">Center size</p>
                    <SliderControl
                      value={activeRadialChart.centerRadius ?? 14}
                      min={0}
                      max={42}
                      step={1}
                      onChange={(value) => setRadialChart({ ...activeRadialChart, centerRadius: value, enabled: true })}
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-[9px] text-muted-foreground">Center text size</p>
                    <SliderControl
                      value={activeRadialChart.centerFontSize ?? Math.round(Math.max(5, Math.min(36, (activeRadialChart.centerRadius ?? 14) * 0.38)))}
                      min={2}
                      max={64}
                      step={1}
                      suffix="px"
                      onChange={(value) => setRadialChart({ ...activeRadialChart, centerFontSize: value, enabled: true })}
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-[9px] text-muted-foreground">Sector rotation</p>
                    <SliderControl
                      value={activeRadialChart.rotation ?? 0}
                      min={-180}
                      max={180}
                      step={1}
                      suffix="deg"
                      onChange={(value) => setRadialChart({ ...activeRadialChart, rotation: value, enabled: true })}
                    />
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-full text-xs"
                  onClick={() => {
                    const rings = activeRadialChart.rings ?? [];
                    const previous = rings.at(-1);
                    const ring: RadialChartRing = {
                      id: generateId(),
                      segmentCount: previous?.segmentCount ?? 8,
                    };
                    setRadialChart({
                      ...activeRadialChart,
                      enabled: true,
                      rings: [...rings, { ...ring, segments: normalizeRadialSegments(ring) }],
                    });
                  }}
                >
                  <Plus className="mr-1 h-3 w-3" /> Add ring
                </Button>

                <div className="space-y-2">
                  {(activeRadialChart.rings ?? []).map((ring, ringIndex) => {
                    const segments = normalizeRadialSegments(ring);
                    return (
                      <div key={ring.id} className="rounded-lg border border-border p-2 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">Chart ring {ringIndex + 1}</span>
                          <button
                            className="text-[10px] text-destructive hover:underline"
                            onClick={() => setRadialChart({
                              ...activeRadialChart,
                              enabled: true,
                              rings: (activeRadialChart.rings ?? []).filter((_, idx) => idx !== ringIndex),
                            })}
                          >
                            Remove
                          </button>
                        </div>
                        <div>
                          <p className="mb-1 text-[9px] text-muted-foreground">Segments</p>
                          <SliderControl
                            value={ring.segmentCount}
                            min={1}
                            max={72}
                            step={1}
                            onChange={(value) => updateRadialRing(ringIndex, { segmentCount: value })}
                          />
                        </div>
                        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                          {segments.map((segment, segmentIndex) => (
                            <div key={segment.id} className="space-y-1.5 rounded-md border border-border/70 p-1.5">
                              <div className="grid grid-cols-[1fr_28px_28px] items-center gap-1.5">
                                <Input
                                  aria-label={`Ring ${ringIndex + 1} segment ${segmentIndex + 1} text`}
                                  name={`radial-ring-${ringIndex + 1}-segment-${segmentIndex + 1}-text`}
                                  value={segment.text ?? ""}
                                  placeholder={`Segment ${segmentIndex + 1}`}
                                  className="h-7 text-xs"
                                  onChange={(event) => updateRadialSegment(ringIndex, segmentIndex, { text: event.target.value })}
                                />
                                <input
                                  aria-label={`Ring ${ringIndex + 1} segment ${segmentIndex + 1} fill color`}
                                  name={`radial-ring-${ringIndex + 1}-segment-${segmentIndex + 1}-fill`}
                                  type="color"
                                  value={hexInputColor(segment.fillColor, RADIAL_SEGMENT_COLORS[segmentIndex % RADIAL_SEGMENT_COLORS.length])}
                                  onChange={(event) => updateRadialSegment(ringIndex, segmentIndex, { fillColor: event.target.value })}
                                  className="h-7 w-7 rounded border border-border bg-background"
                                />
                                <input
                                  aria-label={`Ring ${ringIndex + 1} segment ${segmentIndex + 1} text color`}
                                  name={`radial-ring-${ringIndex + 1}-segment-${segmentIndex + 1}-text-color`}
                                  type="color"
                                  value={hexInputColor(segment.textColor, "#111827")}
                                  onChange={(event) => updateRadialSegment(ringIndex, segmentIndex, { textColor: event.target.value })}
                                  className="h-7 w-7 rounded border border-border bg-background"
                                />
                              </div>
                              <div>
                                <p className="mb-1 text-[9px] text-muted-foreground">Text size</p>
                                <SliderControl
                                  value={segment.fontSize ?? 0}
                                  min={0}
                                  max={64}
                                  step={1}
                                  suffix="px"
                                  onChange={(value) => updateRadialSegment(ringIndex, segmentIndex, { fontSize: value > 0 ? value : undefined })}
                                />
                              </div>
                              <div>
                                <p className="mb-1 text-[9px] text-muted-foreground">Text angle</p>
                                <SliderControl
                                  value={segment.textRotation ?? 0}
                                  min={-180}
                                  max={180}
                                  step={5}
                                  suffix="deg"
                                  onChange={(value) => updateRadialSegment(ringIndex, segmentIndex, { textRotation: value })}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Section>
        )}

        {/* ── Border ── */}
        {isContentNode && (
          <Section label="Border">
            <div>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Color</p>
              <ColorSwatchPicker value={(d.borderColor as string) ?? ""} onChange={(v) => setField("borderColor", v || undefined)} />
            </div>

            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Thickness</p>
              <ThicknessControl value={borderWidth} onChange={(v) => setField("borderWidth", v)} />
            </div>

            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Style</p>
              <BorderStylePicker value={(d.borderStyle as string)} onChange={(v) => setField("borderStyle", v)} />
            </div>

            {supportsRadius && (
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Corner radius</p>
                <SliderControl value={borderRadius} onChange={(value) => setField("borderRadius", value)} suffix="px" />
                <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
                  <span>Sharp</span><span>Pill</span>
                </div>
              </div>
            )}
          </Section>
        )}

        {/* ── Extra border layers ── */}
        {isContentNode && (
          <Section label="Extra borders" defaultOpen={false}>
            {borderLayers.map((layer, i) => (
              <div key={layer.id} className="rounded-lg border border-border p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">Layer {i + 1}</span>
                  <button onClick={() => setField("borderLayers", borderLayers.filter((_, idx) => idx !== i))}
                    className="text-[10px] text-destructive hover:underline">Remove</button>
                </div>
                <ColorSwatchPicker value={layer.color} onChange={(c) => setField("borderLayers", borderLayers.map((l, idx) => idx === i ? { ...l, color: c } : l))} size="sm" />
                <div>
                  <p className="mb-1 text-[10px] text-muted-foreground">Thickness</p>
                  <ThicknessControl value={layer.width}
                    onChange={(v) => setField("borderLayers", borderLayers.map((l, idx) => idx === i ? { ...l, width: v } : l))} />
                </div>
                <div>
                  <p className="mb-1 text-[10px] text-muted-foreground">Style</p>
                  <BorderStylePicker value={layer.style}
                    onChange={(s) => setField("borderLayers", borderLayers.map((l, idx) => idx === i ? { ...l, style: s } : l))} />
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-full h-7 text-xs"
              onClick={() => setField("borderLayers", [...borderLayers, { id: generateId(), color: "#6366f1", width: 2, style: "solid" } as BorderLayer])}>
              <Plus className="h-3 w-3 mr-1" /> Add border layer
            </Button>
          </Section>
        )}

        {/* ── Internal fill regions ── */}
        {isContentNode && (
          <Section label="Fill regions" defaultOpen={false}>
            {/* Region color */}
            <div>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Region color</p>
              <ColorSwatchPicker value={drawingRegionColor} onChange={setDrawingRegionColor} size="sm" />
            </div>

            {/* Region opacity */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Region opacity</p>
              </div>
              <SliderControl
                value={Math.round(drawingRegionOpacity * 100)}
                onChange={(value) => setDrawingRegionOpacity(value / 100)}
                suffix="%"
              />
            </div>

            {/* Draw / Stop freeform button */}
            <Button
              variant={isDrawing ? "destructive" : "default"}
              size="sm"
              className="w-full h-8 text-xs gap-1.5"
              onClick={() => setDrawingModeNodeId(isDrawing ? null : selectedNode.id)}
            >
              {isDrawing
                ? <><StopCircle className="h-3.5 w-3.5" />Stop drawing</>
                : <><Pencil className="h-3.5 w-3.5" />Free-draw region</>}
            </Button>
            {isDrawing && (
              <p className="text-[10px] text-muted-foreground text-center">
                Click &amp; drag inside the node to draw a region
              </p>
            )}

            {/* Add predefined shape regions */}
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Add shape fill</p>
              <div className="grid grid-cols-3 gap-1">
                {([
                  ["rect", "Rect"], ["circle", "Circle"], ["ellipse", "Ellipse"],
                  ["diamond", "Diamond"], ["triangle", "Triangle"],
                ] as [string, string][]).map(([kind, label]) => (
                  <button key={kind}
                    onClick={() => {
                      pushHistory();
                      updateNodeData(selectedNode.id, {
                        internalFillRegions: [...fillRegions, {
                          id: generateId(),
                          kind,
                          rect: { x: 30, y: 30, w: 40, h: 40 },
                          fillColor: drawingRegionColor,
                          opacity: drawingRegionOpacity,
                          createdAt: new Date().toISOString(),
                        } as InternalFillRegion],
                      });
                    }}
                    className="rounded-lg border border-border px-1 py-1.5 text-[10px] hover:bg-muted text-center">
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[9px] text-muted-foreground text-center">Select the node, then drag to move / resize</p>
            </div>

            {/* Existing regions */}
            {fillRegions.length > 0 && (
              <div className="space-y-2 pt-1">
                {fillRegions.map((r, i) => (
                  <div key={r.id} className="rounded-lg border border-border p-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-5 flex-none rounded-full border border-border" style={{ backgroundColor: r.fillColor }} />
                      <span className="flex-1 text-[10px] text-muted-foreground capitalize">{r.kind ?? "free"} {i + 1}</span>
                      <button onClick={() => setField("internalFillRegions", fillRegions.filter((_, idx) => idx !== i))}
                        className="text-[10px] text-destructive hover:underline">Del</button>
                    </div>
                    <ColorSwatchPicker value={r.fillColor}
                      onChange={(c) => setField("internalFillRegions", fillRegions.map((x, idx) => idx === i ? { ...x, fillColor: c } : x))}
                      size="sm" />
                    <div>
                      <p className="mb-1 text-[9px] text-muted-foreground">Opacity</p>
                      <SliderControl
                        value={Math.round((r.opacity ?? 0.18) * 100)}
                        onChange={(value) => setField("internalFillRegions", fillRegions.map((x, idx) => idx === i ? { ...x, opacity: value / 100 } : x))}
                        suffix="%"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ── Convert to ── */}
        {isContentNode && (
          <Section label="Convert to" defaultOpen={false}>
            <div className="grid grid-cols-2 gap-1">
              {CONVERT_TYPES.filter((t) => t.value !== nodeType).map(({ label, value }) => (
                <button key={value}
                  onClick={() => {
                    const extra: Record<string, unknown> = {};
                    if (value === "shape")   extra.shapeType = "rounded";
                    if (value === "mindmap") extra.color ??= "#818cf8";
                    if (value === "sticky")  extra.color ??= "yellow";
                    convertNode(selectedNode.id, value, extra);
                  }}
                  className="rounded-lg border border-border px-2 py-1.5 text-[10px] hover:bg-muted text-center">
                  {label}
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* ── Sanskrit ── */}
        {isSanskrit && (
          <Section label="Sanskrit">
            {"devanagari" in d && <div><Label className="text-xs">Devanāgarī</Label>
              <Textarea aria-label="Devanagari text" name="devanagari" value={(d.devanagari as string) ?? ""} onChange={(e) => setField("devanagari", e.target.value)} className="mt-1 font-devanagari text-base" rows={2} /></div>}
            {"iast" in d && <div><Label className="text-xs">IAST</Label>
              <Textarea aria-label="IAST text" name="iast" value={(d.iast as string) ?? ""} onChange={(e) => setField("iast", e.target.value)} className="mt-1 italic text-sm" rows={2} /></div>}
            {"translation" in d && <div><Label className="text-xs">Translation</Label>
              <Textarea aria-label="Translation text" name="translation" value={(d.translation as string) ?? ""} onChange={(e) => setField("translation", e.target.value)} className="mt-1 text-sm" rows={2} /></div>}
            {"title" in d && <div><Label className="text-xs">Title</Label>
              <Input aria-label="Node title" name="node-title" value={(d.title as string) ?? ""} onChange={(e) => setField("title", e.target.value)} className="mt-1 h-8 text-sm" /></div>}
            {"displayMode" in d && <div><Label className="text-xs">Display mode</Label>
              <Select value={(d.displayMode as string) ?? "both-stacked"} onValueChange={(v) => setField("displayMode", v)}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="devanagari">Devanāgarī only</SelectItem>
                  <SelectItem value="iast">IAST only</SelectItem>
                  <SelectItem value="both-stacked">Both stacked</SelectItem>
                  <SelectItem value="both-side">Side-by-side</SelectItem>
                </SelectContent>
              </Select></div>}
          </Section>
        )}

        {/* ── Script ── */}
        {"scriptMode" in d && (
          <Section label="Script" defaultOpen={false}>
            <Select value={(d.scriptMode as string) ?? "plain"} onValueChange={(v) => setField("scriptMode", v)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="plain">Plain</SelectItem>
                <SelectItem value="devanagari">Devanāgarī</SelectItem>
                <SelectItem value="iast">IAST</SelectItem>
                <SelectItem value="mixed">Mixed</SelectItem>
              </SelectContent>
            </Select>
          </Section>
        )}

        {/* ── Tags ── */}
        <Section label="Tags" defaultOpen={false}>
          <Input value={((d.tags as string[]) ?? []).join(", ")}
            aria-label="Tags"
            name="tags"
            onChange={(e) => setField("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))}
            placeholder="comma separated…" className="h-8 text-xs" />
          <div className="flex flex-wrap gap-1 pt-1">
            {SANSKRIT_TAG_SUGGESTIONS.slice(0, 8).map((tag) => (
              <button key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[10px] hover:bg-accent font-devanagari"
                onClick={() => {
                  const tags = (d.tags as string[]) ?? [];
                  if (!tags.includes(tag)) setField("tags", [...tags, tag]);
                }}>{tag}</button>
            ))}
          </div>
        </Section>

        {/* ── Notes ── */}
        <Section label="Notes" defaultOpen={false}>
          <Textarea value={(d.notes as string) ?? ""} onChange={(e) => setField("notes", e.target.value)}
            aria-label="Private notes" name="notes" rows={3} className="text-sm" placeholder="Private notes…" />
        </Section>
      </div>
    </aside>
  );
}
