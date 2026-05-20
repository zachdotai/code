import type { Hoglet, Nest } from "@main/services/rts/schemas";
import { useMemo } from "react";
import type { HedgemonyHotkeyContext } from "../constants/hotkeys";
import type { ViewMode } from "../state/computeMapClickAction";
import {
  type Selection,
  selectActiveHotkeyContext,
  selectAffiliation,
} from "../state/HedgemonyController";
import { selectHogletById, useHogletStore } from "../stores/hogletStore";

export interface UseHedgemonyDerivedStateOptions {
  selection: Selection;
  mode: ViewMode;
  nests: Nest[];
  dialogOpen: boolean;
}

export interface HedgemonyDerivedState {
  activeNest: Nest | null;
  builderSelected: boolean;
  hedgehouseSelected: boolean;
  selectedHogletIds: Set<string>;
  singleSelectedHogletId: string | null;
  activeHoglet: Hoglet | null;
  affiliatedNestIds: ReadonlySet<string> | null;
  dimWildFlock: boolean;
  buildMode: boolean;
  relocatingNestId: string | null;
  activeHotkeyContext: HedgemonyHotkeyContext | null;
}

/**
 * Pure derivations off the (selection, mode, nests, dialogOpen) tuple. Pulls
 * the dozen one-liners out of the map view so the body of the component is
 * mostly orchestration + JSX.
 */
export function useHedgemonyDerivedState({
  selection,
  mode,
  nests,
  dialogOpen,
}: UseHedgemonyDerivedStateOptions): HedgemonyDerivedState {
  const activeNest =
    selection?.type === "nest"
      ? (nests.find((nest) => nest.id === selection.id) ?? null)
      : null;
  const builderSelected =
    selection?.type === "builder" ||
    (selection?.type === "hoglets" && selection.includeBuilder === true);
  const hedgehouseSelected = selection?.type === "hedgehouse";
  const selectedHogletIds = useMemo(
    () => new Set<string>(selection?.type === "hoglets" ? selection.ids : []),
    [selection],
  );
  const singleSelectedHogletId =
    selection?.type === "hoglets" && selection.ids.length === 1
      ? selection.ids[0]
      : null;
  const activeHoglet = useHogletStore(selectHogletById(singleSelectedHogletId));
  const hogletBuckets = useHogletStore((s) => s.byBucket);

  const { affiliatedNestIds, dimWildFlock } = useMemo(
    () => selectAffiliation(selection, hogletBuckets),
    [selection, hogletBuckets],
  );

  const buildMode = mode.kind === "placingNest";
  const relocatingNestId = mode.kind === "relocatingNest" ? mode.nestId : null;

  const activeHotkeyContext: HedgemonyHotkeyContext | null =
    selectActiveHotkeyContext({
      dialogOpen,
      activeNestId: activeNest?.id ?? null,
      builderSelected,
      hedgehouseSelected,
      singleSelectedHogletId,
    });

  return {
    activeNest,
    builderSelected,
    hedgehouseSelected,
    selectedHogletIds,
    singleSelectedHogletId,
    activeHoglet,
    affiliatedNestIds,
    dimWildFlock,
    buildMode,
    relocatingNestId,
    activeHotkeyContext,
  };
}
