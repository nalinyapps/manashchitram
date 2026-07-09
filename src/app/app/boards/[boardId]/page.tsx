"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getBoard } from "@/lib/storage/board-store";
import { useCanvasStore } from "@/store/canvas-store";
import { CanvasTopbar } from "@/components/canvas/CanvasTopbar";
import { CanvasToolbar } from "@/components/canvas/CanvasToolbar";
import { CanvasInspector } from "@/components/canvas/CanvasInspector";
import { LayoutPanel } from "@/components/canvas/LayoutPanel";
import { CanvasStatusBar } from "@/components/canvas/CanvasStatusBar";
import { VidyaCanvas } from "@/components/canvas/VidyaCanvas";
import { SanskritToolsPanel } from "@/components/sanskrit/SanskritToolsPanel";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { SearchPanel } from "@/components/layout/SearchPanel";
import { useDeviceProfile } from "@/lib/use-device-profile";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui-store";

export default function BoardEditorPage() {
  const params = useParams();
  const boardId = params.boardId as string;
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const setBoard = useCanvasStore((s) => s.setBoard);
  const pushHistory = useCanvasStore((s) => s.pushHistory);
  const layoutPanelOpen = useUIStore((s) => s.layoutPanelOpen);
  const device = useDeviceProfile();
  const isPhone = device.kind === "phone";

  useEffect(() => {
    getBoard(boardId)
      .then((board) => {
        if (board) {
          setBoard(board);
          pushHistory();
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [boardId, setBoard, pushHistory]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="logo-font h-8 w-8 rounded-xl bg-primary flex items-center justify-center text-primary-foreground text-base">म</div>
          <p className="text-sm text-muted-foreground animate-pulse">Loading board…</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6">
        <div className="max-w-sm rounded-2xl border bg-card p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Board not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Board not found or you do not have access.
          </p>
          <Link href="/app/boards" className="mt-4 inline-block text-sm text-primary hover:underline">
            Back to your boards
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-[100dvh] flex-col overflow-hidden bg-background"
      data-device-kind={device.kind}
      data-platform={device.platform}
      data-input={device.input}
    >
      <CanvasTopbar />

      {/* Canvas + floating overlays */}
      <div className="relative flex-1 overflow-hidden">
        {/* Canvas fills entire space */}
        <VidyaCanvas boardId={boardId} />

        {/* Floating left toolbar */}
        <div
          className={cn(
            "pointer-events-none absolute z-30 flex",
            isPhone
              ? "inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+2.75rem)] justify-center px-3"
              : "inset-y-0 left-0 items-center pl-3"
          )}
        >
          <div className="pointer-events-auto">
            <CanvasToolbar />
          </div>
        </div>

        {/* Floating layout panel (left, next to toolbar) */}
        <div
          className={cn(
            "pointer-events-none absolute z-40 flex",
            isPhone
              ? "inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+6.25rem)] justify-center"
              : "inset-y-0 left-16 items-start pt-3"
          )}
        >
          <div className="pointer-events-auto">
            <LayoutPanel />
          </div>
        </div>

        {/* Floating right inspector */}
        <div
          className={cn(
            "pointer-events-none absolute z-40 flex",
            isPhone
              ? "inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+6.25rem)] justify-center"
              : "inset-y-0 right-0 items-start pt-3 pr-3"
          )}
        >
          <div className="pointer-events-auto max-h-[calc(100dvh-100px)] overflow-y-auto">
            {!(isPhone && layoutPanelOpen) && <CanvasInspector compact={isPhone} />}
          </div>
        </div>

        {/* Status bar inside canvas area */}
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 flex justify-center",
            isPhone ? "bottom-[calc(env(safe-area-inset-bottom)+0.5rem)]" : "bottom-0 pb-3"
          )}
        >
          <div className="pointer-events-auto">
            <CanvasStatusBar />
          </div>
        </div>
      </div>

      <SanskritToolsPanel />
      <CommandPalette />
      <SearchPanel />
    </div>
  );
}
