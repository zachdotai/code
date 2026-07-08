import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// View state for the thread side panel — the right-hand human conversation
// dock next to a channel feed or task detail. Which thread is open is tracked
// per tab, keyed by channelId: each channel-home tab is unique to its channel
// (tab dedup forbids two home tabs for the same channel), and separate windows
// are separate renderer stores — so switching tabs keeps each tab's own thread
// open. Collapse and width are global, persisted user preferences so the panel
// keeps its shape across tabs, channels, and tasks.
const DEFAULT_PANEL_WIDTH = 360;

interface ThreadPanelState {
  /** Open thread per tab, keyed by channelId. Missing/null = panel closed. */
  openByChannel: Record<string, string | null>;
  collapsed: boolean;
  width: number;
  /** Points a tab's panel at a task; expands it unless `expand: false`. */
  openThread: (
    channelId: string,
    taskId: string,
    opts?: { expand?: boolean },
  ) => void;
  closeThread: (channelId: string) => void;
  setCollapsed: (collapsed: boolean) => void;
  setWidth: (width: number) => void;
}

export const useThreadPanelStore = create<ThreadPanelState>()(
  persist(
    (set) => ({
      openByChannel: {},
      collapsed: false,
      width: DEFAULT_PANEL_WIDTH,
      openThread: (channelId, taskId, opts) =>
        set((state) => ({
          openByChannel: { ...state.openByChannel, [channelId]: taskId },
          ...(opts?.expand === false ? {} : { collapsed: false }),
        })),
      closeThread: (channelId) =>
        set((state) => ({
          openByChannel: { ...state.openByChannel, [channelId]: null },
        })),
      setCollapsed: (collapsed) => set({ collapsed }),
      setWidth: (width) => set({ width }),
    }),
    {
      name: "thread-panel-storage",
      storage: electronStorage,
      partialize: (state) => ({
        collapsed: state.collapsed,
        width: state.width,
      }),
    },
  ),
);
