import {
  genderForName,
  type HogletGender,
} from "@main/services/rts/hoglet-names";
import type { Nest } from "@main/services/rts/schemas";
import type { RefObject } from "react";
import { useCallback } from "react";
import { toast } from "sonner";
import { playSfx } from "../audio/sfx";
import { playVoice } from "../audio/voice";
import type { MapSurfaceHandle } from "../components/HedgemonyMapSurface";
import {
  BUILDER_NAME,
  HEDGEHOUSE_MAP_X,
  HEDGEHOUSE_MAP_Y,
} from "../constants/map";
import type { ViewMode } from "../state/computeMapClickAction";
import {
  nextCycleNest,
  recallControlGroupSelection,
  type Selection,
  snapshotSelectionForControlGroup,
  toggleHogletSelection,
} from "../state/HedgemonyController";
import {
  type ControlGroupSlot,
  useControlGroupStore,
} from "../stores/controlGroupStore";
import { useHogletPositionStore } from "../stores/hogletPositionStore";
import { selectHogletById, useHogletStore } from "../stores/hogletStore";
import { selectNests, useNestStore } from "../stores/nestStore";
import { collectHogletWorldPositions } from "../utils/hogletPositions";
import { applyHogletVisualPositions } from "../utils/hogletVisualPositions";
import type { Vec2 } from "../utils/pathfinding";

export interface UseHedgemonyCommandsOptions {
  nests: Nest[];
  selection: Selection;
  setMode: (next: ViewMode) => void;
  setSelection: (next: Selection | ((prev: Selection) => Selection)) => void;
  builderPosOrFallback: () => Vec2;
  surfaceRef: RefObject<MapSurfaceHandle | null>;
}

export interface HedgemonyCommands {
  selectBuilder: () => void;
  selectHedgehouse: () => void;
  cycleNest: (direction: 1 | -1) => void;
  handleAssignControlGroup: (slot: ControlGroupSlot) => void;
  recallControlGroup: (slot: ControlGroupSlot) => void;
  handleHogletSelect: (hogletId: string, additive: boolean) => void;
  beginBuildNest: () => void;
  beginQuickNest: () => void;
  beginRelocateNest: (id: string) => void;
  voiceGenderForHoglet: (hogletId: string) => HogletGender;
  /** Click-handler variants — same selection result as the F-key actions but
   * without the camera-pan, because clicking already centered the player's
   * attention on the target. */
  clickSelectNest: (id: string) => void;
  clickSelectBuilder: () => void;
  clickSelectHedgehouse: () => void;
  toggleMoneyHog: () => void;
  /** Focus one hoglet from the NestDetailPanel: select it solo + pan the
   * camera to it so it's visible behind the panel. */
  focusHoglet: (hogletId: string) => void;
}

/**
 * Player-action callbacks bundle. Centralizes the audio + voice cues,
 * camera-centering effect, and Controller delegations that every selection /
 * control-group / build action shares.
 */
export function useHedgemonyCommands({
  nests,
  selection,
  setMode,
  setSelection,
  builderPosOrFallback,
  surfaceRef,
}: UseHedgemonyCommandsOptions): HedgemonyCommands {
  const voiceGenderForHoglet = useCallback((hogletId: string) => {
    const hoglet = selectHogletById(hogletId)(useHogletStore.getState());
    return genderForName(hoglet?.name ?? null);
  }, []);

  const selectBuilder = useCallback(() => {
    playSfx("select");
    playVoice("builder:select", genderForName(BUILDER_NAME));
    setSelection({ type: "builder" });
    const pos = builderPosOrFallback();
    surfaceRef.current?.centerOnPoint(pos.x, pos.y);
  }, [builderPosOrFallback, setSelection, surfaceRef]);

  const selectHedgehouse = useCallback(() => {
    playSfx("select");
    setSelection({ type: "hedgehouse" });
    surfaceRef.current?.centerOnPoint(HEDGEHOUSE_MAP_X, HEDGEHOUSE_MAP_Y);
  }, [setSelection, surfaceRef]);

  const cycleNest = useCallback(
    (direction: 1 | -1) => {
      const result = nextCycleNest(selection, nests, direction);
      if (!result) return;
      playSfx("select");
      playVoice("hedgehog:select");
      setSelection(result.selection);
      surfaceRef.current?.centerOnPoint(result.centerOn.x, result.centerOn.y);
    },
    [nests, selection, setSelection, surfaceRef],
  );

  const assignControlGroup = useControlGroupStore((s) => s.assign);
  const handleAssignControlGroup = useCallback(
    (slot: ControlGroupSlot) => {
      const result = snapshotSelectionForControlGroup(selection);
      if (result.kind === "nothing-selected") {
        toast(`Nothing selected for group ${slot}`, {
          description: "Select a unit or nest first, then assign.",
        });
        return;
      }
      assignControlGroup(slot, result.snapshot);
      playSfx("select");
      toast(`Saved control group ${slot}`, {
        description: `Press ${slot} to recall.`,
      });
    },
    [selection, assignControlGroup],
  );

  const recallControlGroup = useCallback(
    (slot: ControlGroupSlot) => {
      const saved = useControlGroupStore.getState().groups[slot];
      const byBucket = useHogletStore.getState().byBucket;
      const liveHogletIds = new Set<string>();
      for (const bucket of Object.values(byBucket)) {
        for (const h of bucket) liveHogletIds.add(h.id);
      }
      const result = recallControlGroupSelection(
        saved,
        slot,
        liveHogletIds,
        nests,
      );
      if (result.kind === "not-saved") {
        toast(`No group ${slot} saved`, {
          description: `Select something and press Mod+Shift+${slot} to save.`,
        });
        return;
      }
      if (result.kind === "empty") {
        toast(`Group ${slot} is empty`, {
          description:
            result.reason === "decayed"
              ? "All members were retired."
              : "The saved nest was archived.",
        });
        return;
      }

      const recalled = result.selection;
      let centerPoint: { x: number; y: number } | null = null;
      if (recalled.type === "hoglets") {
        if (recalled.ids.length > 0) {
          const positions = collectHogletWorldPositions(
            nests,
            byBucket,
            useHogletPositionStore.getState().positions,
          );
          const alivePositions = positions.filter((p) =>
            recalled.ids.includes(p.hogletId),
          );
          if (alivePositions.length > 0) {
            const sumX = alivePositions.reduce((s, p) => s + p.x, 0);
            const sumY = alivePositions.reduce((s, p) => s + p.y, 0);
            centerPoint = {
              x: sumX / alivePositions.length,
              y: sumY / alivePositions.length,
            };
          }
        }
        if (!centerPoint && recalled.includeBuilder) {
          centerPoint = builderPosOrFallback();
        }
      } else if (recalled.type === "nest") {
        const nest = nests.find((n) => n.id === recalled.id);
        if (nest) centerPoint = { x: nest.mapX, y: nest.mapY };
      } else if (recalled.type === "builder") {
        centerPoint = builderPosOrFallback();
      } else if (recalled.type === "hedgehouse") {
        centerPoint = { x: HEDGEHOUSE_MAP_X, y: HEDGEHOUSE_MAP_Y };
      }

      playSfx("select");
      if (result.voiceHogletId) {
        playVoice("hoglet:select", voiceGenderForHoglet(result.voiceHogletId));
      } else if (recalled.type === "builder") {
        playVoice("builder:select", genderForName(BUILDER_NAME));
      } else if (recalled.type === "nest") {
        playVoice("hedgehog:select");
      }
      setSelection(recalled);
      if (centerPoint) {
        surfaceRef.current?.centerOnPoint(centerPoint.x, centerPoint.y);
      }
    },
    [
      nests,
      builderPosOrFallback,
      voiceGenderForHoglet,
      setSelection,
      surfaceRef,
    ],
  );

  const handleHogletSelect = useCallback(
    (hogletId: string, additive: boolean) => {
      playSfx("select");
      playVoice("hoglet:select", voiceGenderForHoglet(hogletId));
      setSelection((prev) => toggleHogletSelection(prev, hogletId, additive));
    },
    [voiceGenderForHoglet, setSelection],
  );

  const beginBuildNest = useCallback(() => {
    playVoice("builder:build_mode", genderForName(BUILDER_NAME));
    setMode({ kind: "placingNest", creationMode: "guided" });
    setSelection({ type: "builder" });
  }, [setMode, setSelection]);

  const beginQuickNest = useCallback(() => {
    playVoice("builder:build_mode", genderForName(BUILDER_NAME));
    setMode({ kind: "placingNest", creationMode: "simple" });
    setSelection({ type: "builder" });
  }, [setMode, setSelection]);

  const beginRelocateNest = useCallback(
    (id: string) => {
      setMode({ kind: "relocatingNest", nestId: id });
    },
    [setMode],
  );

  const clickSelectNest = useCallback(
    (id: string) => {
      playSfx("select");
      playVoice("hedgehog:select");
      setSelection({ type: "nest", id });
    },
    [setSelection],
  );

  const clickSelectBuilder = useCallback(() => {
    playSfx("select");
    playVoice("builder:select", genderForName(BUILDER_NAME));
    setSelection({ type: "builder" });
  }, [setSelection]);

  const clickSelectHedgehouse = useCallback(() => {
    playSfx("select");
    setSelection({ type: "hedgehouse" });
  }, [setSelection]);

  const toggleMoneyHog = useCallback(() => {
    playSfx("select");
    setSelection((prev) =>
      prev?.type === "money-hog" ? null : { type: "money-hog" },
    );
  }, [setSelection]);

  const focusHoglet = useCallback(
    (hogletId: string) => {
      playSfx("select");
      playVoice("hoglet:select", voiceGenderForHoglet(hogletId));
      setSelection({ type: "hoglets", ids: [hogletId] });
      const positions = applyHogletVisualPositions(
        collectHogletWorldPositions(
          selectNests(useNestStore.getState()),
          useHogletStore.getState().byBucket,
          useHogletPositionStore.getState().positions,
        ),
      );
      const pos = positions.find((p) => p.hogletId === hogletId);
      if (pos) surfaceRef.current?.centerOnPoint(pos.x, pos.y);
    },
    [voiceGenderForHoglet, setSelection, surfaceRef],
  );

  return {
    selectBuilder,
    selectHedgehouse,
    cycleNest,
    handleAssignControlGroup,
    recallControlGroup,
    handleHogletSelect,
    beginBuildNest,
    beginQuickNest,
    beginRelocateNest,
    voiceGenderForHoglet,
    clickSelectNest,
    clickSelectBuilder,
    clickSelectHedgehouse,
    toggleMoneyHog,
    focusHoglet,
  };
}
