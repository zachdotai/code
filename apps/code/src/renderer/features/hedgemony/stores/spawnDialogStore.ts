import { create } from "zustand";

/**
 * Transient open/close state for the spawn-hoglet panel. Lives in its own
 * store because the open-trigger is in CommandCenterToolbar while the panel
 * itself mounts inside HedgemonyMapView.
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
