import { create } from "zustand";

export interface PendingCreateDraft {
  name?: string;
  prompt?: string;
  sources?: string[];
  scheduleText?: string;
  enabled?: boolean;
}

export interface PendingEditDraft {
  id: string;
  name?: string;
  prompt?: string;
  sources?: string[];
  scheduleText?: string;
  enabled?: boolean;
}

interface WorkStoreState {
  /** Draft seed for a brand-new scheduled-task editor session — cleared once consumed. */
  pendingCreateDraft: PendingCreateDraft | null;
  /** In-flight edits for an existing scheduled task, preserved across navigation (e.g. when the user jumps to MCP servers to connect a source). Cleared once consumed. */
  pendingEditDraft: PendingEditDraft | null;
}

interface WorkStoreActions {
  setPendingCreateDraft: (draft: PendingCreateDraft | null) => void;
  consumePendingCreateDraft: () => PendingCreateDraft | null;
  setPendingEditDraft: (draft: PendingEditDraft | null) => void;
  consumePendingEditDraft: (id: string) => PendingEditDraft | null;
}

type WorkStore = WorkStoreState & WorkStoreActions;

export const useWorkStore = create<WorkStore>()((set, get) => ({
  pendingCreateDraft: null,
  pendingEditDraft: null,
  setPendingCreateDraft: (draft) => set({ pendingCreateDraft: draft }),
  consumePendingCreateDraft: () => {
    const value = get().pendingCreateDraft;
    if (value !== null) set({ pendingCreateDraft: null });
    return value;
  },
  setPendingEditDraft: (draft) => set({ pendingEditDraft: draft }),
  consumePendingEditDraft: (id) => {
    const value = get().pendingEditDraft;
    if (value === null || value.id !== id) return null;
    set({ pendingEditDraft: null });
    return value;
  },
}));
