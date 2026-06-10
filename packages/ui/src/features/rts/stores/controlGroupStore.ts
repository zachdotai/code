import { create } from "zustand";

/**
 * RTS-style control groups: snapshot the current selection into a numbered
 * slot, recall it later with the bare digit key. Intentionally transient —
 * SC and AoE groups don't survive a session restart and players don't expect
 * them to here either.
 */

export type ControlGroupSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type ControlGroupSelection =
  | { type: "nest"; id: string }
  | { type: "builder" }
  | { type: "hedgehouse" }
  | { type: "hoglets"; ids: string[]; includeBuilder?: boolean };

interface ControlGroupState {
  groups: Partial<Record<ControlGroupSlot, ControlGroupSelection>>;
}

interface ControlGroupActions {
  assign: (slot: ControlGroupSlot, selection: ControlGroupSelection) => void;
  clear: (slot: ControlGroupSlot) => void;
}

type ControlGroupStore = ControlGroupState & ControlGroupActions;

export const useControlGroupStore = create<ControlGroupStore>()((set) => ({
  groups: {},
  assign: (slot, selection) =>
    set((state) => ({ groups: { ...state.groups, [slot]: selection } })),
  clear: (slot) =>
    set((state) => {
      const next = { ...state.groups };
      delete next[slot];
      return { groups: next };
    }),
}));

export const CONTROL_GROUP_SLOTS: readonly ControlGroupSlot[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9,
] as const;
