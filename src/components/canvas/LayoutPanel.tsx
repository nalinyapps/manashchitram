"use client";

import { X } from "lucide-react";
import { useCanvasStore } from "@/store/canvas-store";
import { useUIStore } from "@/store/ui-store";
import { LAYOUT_OPTIONS, type LayoutMode } from "@/lib/layout";
import { cn } from "@/lib/utils";

// ── Schematic SVG previews (56×40) ────────────────────────────────────────────
const dot = (x: number, y: number, r = 3.2, fill = "#4262ff") => (
  <circle cx={x} cy={y} r={r} fill={fill} />
);
const line = (x1: number, y1: number, x2: number, y2: number) => (
  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#94a3b8" strokeWidth="1" />
);

function Preview({ mode }: { mode: LayoutMode }) {
  let content: React.ReactNode;
  switch (mode) {
    case "topDown":
      content = <>{line(28, 8, 12, 24)}{line(28, 8, 28, 24)}{line(28, 8, 44, 24)}{dot(28, 8)}{dot(12, 26)}{dot(28, 26)}{dot(44, 26)}</>;
      break;
    case "horizontal":
      content = <>{line(10, 20, 30, 8)}{line(10, 20, 30, 20)}{line(10, 20, 30, 32)}{dot(10, 20)}{dot(32, 8)}{dot(32, 20)}{dot(32, 32)}</>;
      break;
    case "vertical":
      content = <>{line(28, 6, 14, 20)}{line(28, 6, 42, 20)}{line(14, 20, 8, 34)}{line(42, 20, 48, 34)}{dot(28, 6)}{dot(14, 20)}{dot(42, 20)}{dot(8, 34)}{dot(48, 34)}</>;
      break;
    case "list":
      content = <>{dot(10, 8, 2.6)}{dot(18, 16, 2.6)}{dot(26, 24, 2.6)}{dot(18, 32, 2.6)}{line(10, 8, 10, 34)}</>;
      break;
    case "linear":
      content = <>{line(8, 20, 48, 20)}{dot(10, 20)}{dot(23, 20)}{dot(36, 20)}{dot(48, 20)}</>;
      break;
    case "radial":
      content = <>{line(28, 20, 12, 12)}{line(28, 20, 44, 12)}{line(28, 20, 14, 30)}{line(28, 20, 42, 30)}{dot(28, 20, 4)}{dot(12, 12)}{dot(44, 12)}{dot(14, 30)}{dot(42, 30)}</>;
      break;
    case "matrix":
      content = <>{[10, 24, 38].map((x) => [10, 20, 30].map((y) => <circle key={`${x}-${y}`} cx={x + 4} cy={y} r={2.8} fill="#4262ff" />))}</>;
      break;
    case "fromParentFreeForm":
      content = <>{line(28, 20, 12, 10)}{line(28, 20, 46, 14)}{line(28, 20, 20, 33)}{line(28, 20, 44, 32)}{dot(28, 20, 4.2, "#ef4444")}{dot(12, 10)}{dot(46, 14)}{dot(20, 33)}{dot(44, 32)}</>;
      break;
    default: // freeForm
      content = <>{dot(12, 12)}{dot(40, 10)}{dot(22, 28)}{dot(46, 30)}{dot(10, 32)}</>;
  }
  return (
    <svg viewBox="0 0 56 40" className="h-10 w-14 rounded-md border border-border bg-muted/40">
      {content}
    </svg>
  );
}

export function LayoutPanel() {
  const open = useUIStore((s) => s.layoutPanelOpen);
  const setOpen = useUIStore((s) => s.setLayoutPanelOpen);
  const applyLayout = useCanvasStore((s) => s.applyLayout);
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);

  if (!open) return null;

  const scopeLabel = selectedNodeIds.length === 1 ? "Selected branch" : "Whole board";

  const handleApply = (mode: LayoutMode) => {
    applyLayout(mode);
    // Ask the canvas (inside the ReactFlow provider) to fit the view.
    setTimeout(() => window.dispatchEvent(new CustomEvent("vidya:fitview")), 60);
  };

  return (
    <aside className="vidya-float-panel layout-panel flex max-h-[calc(100dvh-100px)] w-64 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <div>
          <h3 className="text-sm font-semibold">Layout</h3>
          <p className="text-[10px] text-muted-foreground">Applies to: {scopeLabel}</p>
        </div>
        <button onClick={() => setOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="flex flex-col gap-1">
          {LAYOUT_OPTIONS.map((opt) => (
            <button
              key={opt.mode}
              onClick={() => handleApply(opt.mode)}
              className={cn(
                "flex items-center gap-3 rounded-lg border border-transparent p-2 text-left transition-colors",
                "hover:border-border hover:bg-accent"
              )}
            >
              <Preview mode={opt.mode} />
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">{opt.label}</div>
                <div className="truncate text-[10px] text-muted-foreground">{opt.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
        Tip: select a node first to arrange just its branch.
      </div>
    </aside>
  );
}
