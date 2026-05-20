import type { Nest } from "@main/services/rts/schemas";
import type {
  ControlGroupSelection,
  ControlGroupSlot,
} from "../stores/controlGroupStore";
import type { ViewMode } from "./computeMapClickAction";

/**
 * Top-level selection model for the map. `money-hog` is the FinOps panel
 * toggle; it lives in this union (rather than a separate piece of state) so
 * panels and selection-clear-on-Escape work uniformly.
 */
export type Selection =
  | { type: "nest"; id: string }
  | { type: "builder" }
  | { type: "hedgehouse" }
  | { type: "money-hog" }
  | { type: "hoglets"; ids: string[]; includeBuilder?: boolean }
  | null;

export interface ControllerState {
  mode: ViewMode;
  selection: Selection;
}

/* ───────────────────────── Cycle nest (F3 / Shift+F3) ───────────────────── */

export interface CycleNestResult {
  selection: Selection;
  centerOn: { x: number; y: number };
}

/**
 * Cycle through the nest list forward (1) or backward (-1). With nothing
 * currently selected, forward starts at the first nest and backward at the
 * last. Returns null when there are no nests to cycle through.
 */
export function nextCycleNest(
  selection: Selection,
  nests: Nest[],
  direction: 1 | -1,
): CycleNestResult | null {
  if (nests.length === 0) return null;
  const currentId = selection?.type === "nest" ? selection.id : null;
  const currentIdx = currentId
    ? nests.findIndex((n) => n.id === currentId)
    : -1;
  const nextIdx =
    currentIdx === -1
      ? direction === 1
        ? 0
        : nests.length - 1
      : (currentIdx + direction + nests.length) % nests.length;
  const nest = nests[nextIdx];
  return {
    selection: { type: "nest", id: nest.id },
    centerOn: { x: nest.mapX, y: nest.mapY },
  };
}

/* ───────────────────────── Toggle hoglet (click / shift+click) ──────────── */

/**
 * Add a hoglet to the selection (or toggle it off when additive-clicking an
 * already-selected hoglet). Non-additive selection replaces with a single
 * hoglet.
 */
export function toggleHogletSelection(
  selection: Selection,
  hogletId: string,
  additive: boolean,
): Selection {
  if (additive && selection?.type === "hoglets") {
    if (selection.ids.includes(hogletId)) {
      const next = selection.ids.filter((id) => id !== hogletId);
      return next.length === 0 ? null : { type: "hoglets", ids: next };
    }
    return { type: "hoglets", ids: [...selection.ids, hogletId] };
  }
  return { type: "hoglets", ids: [hogletId] };
}

/* ───────────────────────── Box select (marquee) ─────────────────────────── */

/**
 * Apply a marquee selection result on top of the current selection.
 * Additive (shift/cmd) unions with the prior selection; non-additive
 * replaces. The builder is treated as a hoglet for selection purposes
 * because the marquee can catch him alongside hoglets.
 */
export function applyBoxSelect(
  selection: Selection,
  hits: string[],
  builderInRect: boolean,
  additive: boolean,
): Selection {
  if (additive) {
    const prevHoglets = selection?.type === "hoglets" ? selection.ids : [];
    const prevBuilder =
      selection?.type === "builder" ||
      (selection?.type === "hoglets" && selection.includeBuilder === true);
    const merged = Array.from(new Set([...prevHoglets, ...hits]));
    const withBuilder = prevBuilder || builderInRect;
    if (merged.length === 0) {
      return withBuilder ? { type: "builder" } : null;
    }
    return withBuilder
      ? { type: "hoglets", ids: merged, includeBuilder: true }
      : { type: "hoglets", ids: merged };
  }
  if (hits.length === 0) {
    return builderInRect ? { type: "builder" } : null;
  }
  return builderInRect
    ? { type: "hoglets", ids: hits, includeBuilder: true }
    : { type: "hoglets", ids: hits };
}

/* ───────────────────────── Control groups ───────────────────────────────── */

export type ControlGroupSnapshotResult =
  | { kind: "ok"; snapshot: ControlGroupSelection }
  | { kind: "nothing-selected" };

/**
 * Convert the current selection into a control-group snapshot. `money-hog`
 * and `null` selections are not saveable. Hoglet ID arrays are copied so
 * future mutations on the live selection don't leak back into the snapshot.
 */
export function snapshotSelectionForControlGroup(
  selection: Selection,
): ControlGroupSnapshotResult {
  if (!selection || selection.type === "money-hog") {
    return { kind: "nothing-selected" };
  }
  const snapshot: ControlGroupSelection =
    selection.type === "hoglets"
      ? {
          type: "hoglets",
          ids: [...selection.ids],
          includeBuilder: selection.includeBuilder,
        }
      : selection;
  return { kind: "ok", snapshot };
}

export type ControlGroupRecallResult =
  | {
      kind: "ok";
      selection: NonNullable<Selection>;
      // Optional voice-line hint for the caller — null means "no hoglet voice
      // applies" so the caller can fall through to builder / nest voices.
      voiceHogletId: string | null;
    }
  | { kind: "empty"; slot: ControlGroupSlot; reason: "decayed" | "archived" }
  | { kind: "not-saved"; slot: ControlGroupSlot };

/**
 * Decide what selection a control-group recall should produce. Hoglet
 * groups are filtered against the live ID set so retired hoglets drop out
 * instead of resurrecting. Nest groups invalidate when the saved nest no
 * longer exists.
 */
export function recallControlGroupSelection(
  saved: ControlGroupSelection | undefined,
  slot: ControlGroupSlot,
  liveHogletIds: ReadonlySet<string>,
  nests: Nest[],
): ControlGroupRecallResult {
  if (!saved) {
    return { kind: "not-saved", slot };
  }
  if (saved.type === "hoglets") {
    const aliveIds = saved.ids.filter((id) => liveHogletIds.has(id));
    if (aliveIds.length === 0 && !saved.includeBuilder) {
      return { kind: "empty", slot, reason: "decayed" };
    }
    return {
      kind: "ok",
      selection: {
        type: "hoglets",
        ids: aliveIds,
        includeBuilder: saved.includeBuilder,
      },
      voiceHogletId: aliveIds[0] ?? null,
    };
  }
  if (saved.type === "nest") {
    const exists = nests.some((n) => n.id === saved.id);
    if (!exists) {
      return { kind: "empty", slot, reason: "archived" };
    }
    return { kind: "ok", selection: saved, voiceHogletId: null };
  }
  return { kind: "ok", selection: saved, voiceHogletId: null };
}

/* ───────────────────────── Escape priority ladder ───────────────────────── */

export interface EscapeContext {
  mode: ViewMode;
  selection: Selection;
  fullscreen: boolean;
  helperOpen: boolean;
}

export interface EscapeResult {
  mode: ViewMode;
  selection: Selection;
  exitFullscreen: boolean;
  // True iff the caller should treat the key as fully handled. False means
  // "no-op" — most importantly, when the hotkey helper is open it consumes
  // Esc on its own and we must not unwind state behind it.
  handled: boolean;
}

/**
 * Unwind the most-specific UI mode first on Escape: placement → fullscreen →
 * selection. Without this ordering, hitting Esc in fullscreen during a
 * placement dumps the user all the way back to nothing-selected.
 */
export function applyEscape({
  mode,
  selection,
  fullscreen,
  helperOpen,
}: EscapeContext): EscapeResult {
  if (helperOpen) {
    return { mode, selection, exitFullscreen: false, handled: false };
  }
  if (mode.kind !== "browsing") {
    return {
      mode: { kind: "browsing" },
      selection,
      exitFullscreen: false,
      handled: true,
    };
  }
  if (fullscreen) {
    return { mode, selection, exitFullscreen: true, handled: true };
  }
  if (selection) {
    return {
      mode,
      selection: null,
      exitFullscreen: false,
      handled: true,
    };
  }
  return { mode, selection, exitFullscreen: false, handled: false };
}

/* ───────────────────────── Hotkey context selector ──────────────────────── */

export type HedgemonyHotkeyContextKind =
  | "dialog"
  | "nest"
  | "builder"
  | "hedgehouse"
  | "hoglet"
  | null;

export interface HotkeyContextInput {
  dialogOpen: boolean;
  activeNestId: string | null;
  builderSelected: boolean;
  hedgehouseSelected: boolean;
  singleSelectedHogletId: string | null;
}

/**
 * Decides which contextual section of the hotkey helper highlights. Ordered
 * by specificity so dialogs always win over selection-context.
 */
export function selectActiveHotkeyContext({
  dialogOpen,
  activeNestId,
  builderSelected,
  hedgehouseSelected,
  singleSelectedHogletId,
}: HotkeyContextInput): HedgemonyHotkeyContextKind {
  if (dialogOpen) return "dialog";
  if (activeNestId) return "nest";
  if (builderSelected) return "builder";
  if (hedgehouseSelected) return "hedgehouse";
  if (singleSelectedHogletId) return "hoglet";
  return null;
}

/* ───────────────────────── Selection derivations ────────────────────────── */

/**
 * Build the focus-state for nest dimming: when a nest is selected, only that
 * nest's brood stays bright; when hoglets are selected, their parent nests
 * are highlighted. Null `affiliatedNestIds` means "render everything at full
 * opacity". `dimWildFlock` decides whether the unaffiliated wild hoglets
 * should fade alongside non-affiliated nests.
 */
export function selectAffiliation(
  selection: Selection,
  hogletBuckets: Record<string, { id: string; nestId: string | null }[]>,
): {
  affiliatedNestIds: ReadonlySet<string> | null;
  dimWildFlock: boolean;
} {
  if (selection?.type === "nest") {
    return {
      affiliatedNestIds: new Set<string>([selection.id]),
      dimWildFlock: true,
    };
  }
  if (selection?.type === "hoglets") {
    const parents = new Set<string>();
    let hasWildSelected = false;
    for (const id of selection.ids) {
      let nestIdForHoglet: string | null | undefined;
      for (const bucket of Object.values(hogletBuckets)) {
        const found = bucket.find((h) => h.id === id);
        if (found) {
          nestIdForHoglet = found.nestId;
          break;
        }
      }
      if (nestIdForHoglet === undefined) continue;
      if (nestIdForHoglet === null) hasWildSelected = true;
      else parents.add(nestIdForHoglet);
    }
    return {
      affiliatedNestIds: parents,
      dimWildFlock: !hasWildSelected,
    };
  }
  return {
    affiliatedNestIds: null,
    dimWildFlock: false,
  };
}
