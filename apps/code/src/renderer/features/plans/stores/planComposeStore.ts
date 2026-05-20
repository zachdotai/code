import { create } from "zustand";

export interface PopoverAnchorRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

interface PlanComposeState {
  open: boolean;
  anchorRect: PopoverAnchorRect | null;
  blockText: string | null;
  filePath: string | null;
  taskId: string | null;
  openAt: (args: {
    anchorRect: PopoverAnchorRect;
    blockText: string;
    filePath: string;
    taskId: string;
  }) => void;
  close: () => void;
}

export const usePlanComposeStore = create<PlanComposeState>((set) => ({
  open: false,
  anchorRect: null,
  blockText: null,
  filePath: null,
  taskId: null,
  openAt: ({ anchorRect, blockText, filePath, taskId }) =>
    set({ open: true, anchorRect, blockText, filePath, taskId }),
  close: () =>
    set({
      open: false,
      anchorRect: null,
      blockText: null,
      filePath: null,
      taskId: null,
    }),
}));
