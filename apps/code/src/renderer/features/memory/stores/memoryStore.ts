import { create } from "zustand";

type MemoryTab = "home" | "files" | "settings";

interface MemoryStoreState {
  selectedPath: string | null;
  editMode: boolean;
  activeTab: MemoryTab;
  recentlyTouched: Set<string>;
}

interface MemoryStoreActions {
  selectEntry: (path: string | null) => void;
  setEditMode: (on: boolean) => void;
  setActiveTab: (tab: MemoryTab) => void;
  markTouched: (relativePath: string) => void;
  clearTouched: (relativePath: string) => void;
}

type MemoryStore = MemoryStoreState & MemoryStoreActions;

export const useMemoryStore = create<MemoryStore>()((set) => ({
  selectedPath: null,
  editMode: false,
  activeTab: "home",
  recentlyTouched: new Set(),

  selectEntry: (path) => set({ selectedPath: path, editMode: false }),
  setEditMode: (on) => set({ editMode: on }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  markTouched: (relativePath) =>
    set((s) => ({
      recentlyTouched: new Set([...s.recentlyTouched, relativePath]),
    })),

  clearTouched: (relativePath) =>
    set((s) => {
      const next = new Set(s.recentlyTouched);
      next.delete(relativePath);
      return { recentlyTouched: next };
    }),
}));
