import type { Nest } from "@posthog/host-router/rts-schemas";
import type { NestCreationMode } from "../components/placeNestDialogReducer";
import type { Vec2 } from "../utils/pathfinding";

/**
 * Top-level interaction modes for the map. At most one is active at a time;
 * collapsing the prior `buildMode`/`relocatingNestId`/`pendingMode` booleans
 * into a discriminated union so handlers switch once with exhaustive checks
 * instead of hand-rolling the same priority ladder. Selection lives outside
 * the mode — it persists across mode transitions.
 */
export type ViewMode =
  | { kind: "browsing" }
  | { kind: "placingNest"; creationMode: NestCreationMode }
  | { kind: "relocatingNest"; nestId: string };

export interface MapClickInput {
  mode: ViewMode;
  click: Vec2;
  nests: Nest[];
}

export type MapClickAction =
  | { kind: "moveNest"; nest: Nest; mapX: number; mapY: number }
  | { kind: "placeNest"; x: number; y: number; creationMode: NestCreationMode }
  | { kind: "clearSelection" }
  | { kind: "noop" };

export interface MapClickResult {
  nextMode: ViewMode;
  action: MapClickAction;
}

/**
 * Decide what a left-click on empty map should do given the current view
 * mode. Pure function — the caller is responsible for applying the
 * resulting `action` (toasts, sfx, store mutations, tRPC calls) and the
 * resulting `nextMode` to its state.
 */
export function computeMapClickAction(input: MapClickInput): MapClickResult {
  const { mode, click, nests } = input;
  switch (mode.kind) {
    case "relocatingNest": {
      const nest = nests.find((n) => n.id === mode.nestId);
      if (!nest) {
        return { nextMode: { kind: "browsing" }, action: { kind: "noop" } };
      }
      return {
        nextMode: { kind: "browsing" },
        action: {
          kind: "moveNest",
          nest,
          mapX: Math.round(click.x),
          mapY: Math.round(click.y),
        },
      };
    }
    case "placingNest": {
      return {
        nextMode: { kind: "browsing" },
        action: {
          kind: "placeNest",
          x: click.x,
          y: click.y,
          creationMode: mode.creationMode,
        },
      };
    }
    case "browsing": {
      return { nextMode: mode, action: { kind: "clearSelection" } };
    }
  }
}
