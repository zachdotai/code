import { create } from "zustand";
import { persist } from "zustand/middleware";

interface McpAppsSidebarState {
  open: boolean;
  widthRatio: number;
  isResizing: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setWidthRatio: (ratio: number) => void;
  setIsResizing: (isResizing: boolean) => void;
}

export const useMcpAppsSidebarStore = create<McpAppsSidebarState>()(
  persist(
    (set) => ({
      open: false,
      widthRatio: 0.5,
      isResizing: false,
      setOpen: (open) => set({ open }),
      toggle: () => set((s) => ({ open: !s.open })),
      setWidthRatio: (widthRatio) => set({ widthRatio }),
      setIsResizing: (isResizing) => set({ isResizing }),
    }),
    {
      name: "mcp-apps-sidebar-storage-v2",
      partialize: (s) => ({ open: s.open, widthRatio: s.widthRatio }),
    },
  ),
);
