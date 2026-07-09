"use client";

import { useState } from "react";
import {
  MousePointer2, Hand, StickyNote, Type, Square, Spline, Frame,
  BookOpen, Scroll, GraduationCap, ChevronRight,
  Circle, Triangle, Diamond, Hexagon, Star, ArrowRight,
  RectangleHorizontal, Network,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUIStore, type ShapeVariant } from "@/store/ui-store";
import type { CanvasTool } from "@/lib/types";
import { useDeviceProfile } from "@/lib/use-device-profile";

/* ── Shape submenu ── */
interface ShapeItem {
  variant: ShapeVariant;
  label: string;
  icon: React.ReactNode;
}

const SHAPES: ShapeItem[] = [
  { variant: "rectangle", label: "Rectangle", icon: <Square className="h-5 w-5 stroke-[1.5]" /> },
  { variant: "rounded",   label: "Rounded",   icon: <RectangleHorizontal className="h-5 w-5 stroke-[1.5]" /> },
  { variant: "circle",    label: "Circle",    icon: <Circle className="h-5 w-5 stroke-[1.5]" /> },
  { variant: "triangle",  label: "Triangle",  icon: <Triangle className="h-5 w-5 stroke-[1.5]" /> },
  { variant: "diamond",   label: "Diamond",   icon: <Diamond className="h-5 w-5 stroke-[1.5]" /> },
  { variant: "hexagon",   label: "Hexagon",   icon: <Hexagon className="h-5 w-5 stroke-[1.5]" /> },
  { variant: "star",      label: "Star",      icon: <Star className="h-5 w-5 stroke-[1.5]" /> },
  { variant: "arrow",     label: "Arrow",     icon: <ArrowRight className="h-5 w-5 stroke-[1.5]" /> },
];

/* ── Sanskrit submenu ── */
interface SanskritItem {
  tool: CanvasTool;
  label: string;
  icon: React.ReactNode;
}

const SANSKRIT_TOOLS: SanskritItem[] = [
  { tool: "sanskrit", label: "Sanskrit Card", icon: <BookOpen className="h-5 w-5 stroke-[1.5]" /> },
  { tool: "shloka",   label: "Śloka Card",    icon: <Scroll className="h-5 w-5 stroke-[1.5]" /> },
  { tool: "grammar",  label: "Grammar Card",  icon: <GraduationCap className="h-5 w-5 stroke-[1.5]" /> },
];

/* ── Divider ── */
function Divider() {
  return <div className="canvas-toolbar-divider my-1 mx-2 h-px bg-border" />;
}

/* ── Simple tool button ── */
function ToolBtn({
  tool, icon, label, shortcut, onClick,
}: {
  tool?: CanvasTool;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
}) {
  const { activeTool, setActiveTool } = useUIStore();
  const isActive = tool !== undefined && activeTool === tool;
  const tooltipSide = useDeviceProfile().kind === "phone" ? "top" : "right";

  const handleClick = () => {
    if (onClick) onClick();
    else if (tool) setActiveTool(tool);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-100",
            isActive
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
          aria-label={label}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className="flex items-center gap-2 rounded-lg text-xs">
        <span>{label}</span>
        {shortcut && (
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{shortcut}</kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/* ── Shapes popover button ── */
function ShapesBtn() {
  const { activeTool, setActiveTool, shapeVariant, setShapeVariant } = useUIStore();
  const [open, setOpen] = useState(false);
  const isActive = activeTool === "shape";
  const currentShape = SHAPES.find((s) => s.variant === shapeVariant) ?? SHAPES[1];
  const panelSide = useDeviceProfile().kind === "phone" ? "top" : "right";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "relative flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-100",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
              aria-label="Shapes"
            >
              {currentShape.icon}
              <ChevronRight className="absolute -right-0.5 bottom-0.5 h-2.5 w-2.5 opacity-50" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side={panelSide} className="text-xs">Shapes</TooltipContent>
      </Tooltip>

      <PopoverContent side={panelSide} align="center" className="w-auto p-2" sideOffset={12}>
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Shapes</p>
        <div className="grid grid-cols-4 gap-1">
          {SHAPES.map((s) => (
            <Tooltip key={s.variant}>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    "flex h-10 w-10 flex-col items-center justify-center rounded-lg transition-all",
                    shapeVariant === s.variant && isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                  onClick={() => {
                    setShapeVariant(s.variant);
                    setActiveTool("shape");
                    setOpen(false);
                  }}
                >
                  {s.icon}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">{s.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ── Sanskrit popover button ── */
function SanskritBtn() {
  const { activeTool, setActiveTool } = useUIStore();
  const [open, setOpen] = useState(false);
  const isSanskritTool = activeTool === "sanskrit" || activeTool === "shloka" || activeTool === "grammar";
  const panelSide = useDeviceProfile().kind === "phone" ? "top" : "right";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "relative flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-100",
                isSanskritTool
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
              aria-label="Sanskrit tools"
            >
              <span className="text-[15px] font-bold leading-none" style={{ fontFamily: "serif" }}>सं</span>
              <ChevronRight className="absolute -right-0.5 bottom-0.5 h-2.5 w-2.5 opacity-50" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side={panelSide} className="text-xs">Sanskrit Cards</TooltipContent>
      </Tooltip>

      <PopoverContent side={panelSide} align="end" className="w-44 p-2" sideOffset={12}>
        <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sanskrit</p>
        <div className="flex flex-col gap-0.5">
          {SANSKRIT_TOOLS.map((s) => (
            <button
              key={s.tool}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all",
                activeTool === s.tool
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-accent hover:text-accent-foreground"
              )}
              onClick={() => {
                setActiveTool(s.tool);
                setOpen(false);
              }}
            >
              {s.icon}
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ── Layout panel toggle ── */
function LayoutBtn() {
  const layoutPanelOpen = useUIStore((s) => s.layoutPanelOpen);
  const setLayoutPanelOpen = useUIStore((s) => s.setLayoutPanelOpen);
  const tooltipSide = useDeviceProfile().kind === "phone" ? "top" : "right";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => setLayoutPanelOpen(!layoutPanelOpen)}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-100",
            layoutPanelOpen
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
          aria-label="Layouts"
        >
          <Network className="h-[18px] w-[18px] stroke-[1.5]" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className="text-xs">Layouts</TooltipContent>
    </Tooltip>
  );
}

/* ── Main toolbar ── */
export function CanvasToolbar() {
  const { setActiveTool } = useUIStore();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="vidya-float-panel canvas-toolbar flex flex-col items-center gap-0.5 p-1.5">
        {/* Navigation */}
        <ToolBtn tool="select" icon={<MousePointer2 className="h-[18px] w-[18px] stroke-[1.5]" />} label="Select" shortcut="V" />
        <ToolBtn tool="pan"    icon={<Hand className="h-[18px] w-[18px] stroke-[1.5]" />}          label="Hand / Pan" shortcut="H" />

        <Divider />

        {/* Creation */}
        <ToolBtn tool="sticky" icon={<StickyNote className="h-[18px] w-[18px] stroke-[1.5]" />}   label="Sticky Note" shortcut="S" />
        <ToolBtn tool="text"   icon={<Type className="h-[18px] w-[18px] stroke-[1.5]" />}          label="Text" shortcut="T" />

        {/* Shapes (with popover) */}
        <ShapesBtn />

        <ToolBtn
          icon={<Spline className="h-[18px] w-[18px] stroke-[1.5]" />}
          label="Connector"
          shortcut="C"
          onClick={() => setActiveTool("connector")}
          tool="connector"
        />
        <ToolBtn tool="frame"  icon={<Frame className="h-[18px] w-[18px] stroke-[1.5]" />}         label="Frame" />

        <Divider />

        {/* Layouts */}
        <LayoutBtn />

        <Divider />

        {/* Sanskrit (with popover) */}
        <SanskritBtn />
      </div>
    </TooltipProvider>
  );
}
