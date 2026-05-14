import { create } from "zustand";

/**
 * Transient dialog state. Lives in its own store because the open-trigger
 * is in CommandCenterToolbar while the dialog itself mounts inside
 * HedgemonyMapView.
 */
interface SpawnDialogStore {
  spawnHogletOpen: boolean;
  openSpawnHoglet: () => void;
  closeSpawnHoglet: () => void;
}

export const useSpawnDialogStore = create<SpawnDialogStore>()((set) => ({
  spawnHogletOpen: false,
  openSpawnHoglet: () => set({ spawnHogletOpen: true }),
  closeSpawnHoglet: () => set({ spawnHogletOpen: false }),
}));
