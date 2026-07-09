"use client";

import { create } from "zustand";
import { LOCAL_STORAGE_KEYS } from "@/lib/config";
import type { AppSettings, CanvasTool, ShapeType } from "@/lib/types";
import { DEFAULT_APP_SETTINGS } from "@/lib/types";

export type ShapeVariant = ShapeType;

interface UIState {
  activeTool: CanvasTool;
  setActiveTool: (tool: CanvasTool) => void;
  touchSelectionMode: boolean;
  setTouchSelectionMode: (active: boolean) => void;
  shapeVariant: ShapeVariant;
  setShapeVariant: (v: ShapeVariant) => void;
  /** ID of the node currently in free-draw internal-fill mode, or null */
  drawingModeNodeId: string | null;
  setDrawingModeNodeId: (id: string | null) => void;
  /** Fill color chosen for the next drawn region */
  drawingRegionColor: string;
  setDrawingRegionColor: (color: string) => void;
  /** Opacity (0–1) for the next drawn/added region */
  drawingRegionOpacity: number;
  setDrawingRegionOpacity: (o: number) => void;
  theme: "light" | "dark" | "system";
  setTheme: (theme: "light" | "dark" | "system") => void;
  sanskritPanelOpen: boolean;
  setSanskritPanelOpen: (open: boolean) => void;
  layoutPanelOpen: boolean;
  setLayoutPanelOpen: (open: boolean) => void;
  searchPanelOpen: boolean;
  setSearchPanelOpen: (open: boolean) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  aiPanelOpen: boolean;
  setAiPanelOpen: (open: boolean) => void;
  appSettings: AppSettings;
  updateAppSettings: (partial: Partial<AppSettings>) => void;
  loadAppSettings: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  activeTool: "select",
  setActiveTool: (tool) => set({
    activeTool: tool,
    ...(tool !== "select" ? { touchSelectionMode: false } : {}),
  }),
  touchSelectionMode: false,
  setTouchSelectionMode: (active) => set({
    touchSelectionMode: active,
    activeTool: active ? "select" : get().activeTool,
  }),
  shapeVariant: "rounded",
  setShapeVariant: (v) => set({ shapeVariant: v }),
  drawingModeNodeId: null,
  setDrawingModeNodeId: (id) => set({ drawingModeNodeId: id }),
  drawingRegionColor: "#ef4444",
  setDrawingRegionColor: (color) => set({ drawingRegionColor: color }),
  drawingRegionOpacity: 0.3,
  setDrawingRegionOpacity: (o) => set({ drawingRegionOpacity: o }),
  theme: "system",
  setTheme: (theme) => {
    set({ theme });
    const settings = { ...get().appSettings, theme };
    localStorage.setItem(LOCAL_STORAGE_KEYS.settings, JSON.stringify(settings));
    set({ appSettings: settings });
  },
  sanskritPanelOpen: false,
  setSanskritPanelOpen: (open) => set({ sanskritPanelOpen: open }),
  layoutPanelOpen: false,
  setLayoutPanelOpen: (open) => set({ layoutPanelOpen: open }),
  searchPanelOpen: false,
  setSearchPanelOpen: (open) => set({ searchPanelOpen: open }),
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  aiPanelOpen: false,
  setAiPanelOpen: (open) => set({ aiPanelOpen: open }),
  appSettings: DEFAULT_APP_SETTINGS,
  updateAppSettings: (partial) => {
    const settings = { ...get().appSettings, ...partial };
    localStorage.setItem(LOCAL_STORAGE_KEYS.settings, JSON.stringify(settings));
    set({ appSettings: settings });
  },
  loadAppSettings: () => {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEYS.settings);
      if (raw) {
        const settings = JSON.parse(raw) as AppSettings;
        set({ appSettings: settings, theme: settings.theme });
      }
    } catch {
      // use defaults
    }
  },
}));

export const TOOL_SHORTCUTS: Record<string, CanvasTool> = {
  v: "select",
  h: "pan",
  m: "mindmap",
  s: "sticky",
  t: "text",
  c: "connector",
  r: "shape",
};

export const TOOL_LABELS: Record<CanvasTool, string> = {
  select: "Select",
  pan: "Hand / Pan",
  mindmap: "Mind-map Node",
  sticky: "Sticky Note",
  text: "Text Block",
  shape: "Shape",
  connector: "Connector",
  frame: "Frame",
  pen: "Pen (placeholder)",
  image: "Image (placeholder)",
  sanskrit: "Sanskrit Card",
  shloka: "Śloka Card",
  grammar: "Grammar Card",
};

export const TOOL_KEYS: Partial<Record<CanvasTool, string>> = {
  select: "V",
  pan: "H",
  mindmap: "M",
  sticky: "S",
  text: "T",
  connector: "C",
  shape: "R",
};
