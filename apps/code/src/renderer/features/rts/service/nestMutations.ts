import type { Nest } from "@main/services/rts/schemas";
import { logger } from "@utils/logger";
import { sonnerToastSink } from "../adapters/sonnerToastSink";
import { trpcNestRemoteService } from "../adapters/trpcNestRemoteService";
import { zustandNestRepository } from "../adapters/zustandNestRepository";
import { playSfx } from "../audio/sfx";
import type { NestRemoteService } from "../domain/NestRemoteService";
import type { NestRepository } from "../domain/NestRepository";
import type { ToastSink } from "../domain/ToastSink";

const log = logger.scope("nest-mutations");

export interface MoveNestDeps {
  nests: NestRepository;
  remote: NestRemoteService;
  toast?: ToastSink;
}

export const defaultMoveNestDeps: MoveNestDeps = {
  nests: zustandNestRepository,
  remote: trpcNestRemoteService,
  toast: sonnerToastSink,
};

export interface MoveNestOptions {
  /**
   * When true, surfaces an undo toast that re-runs moveNest to put the nest
   * back where it was. The undo path itself is not undoable, so a chain of
   * undos collapses to a single hop.
   */
  undoable?: boolean;
  /**
   * Optional callback to flash a visual ping at the destination. Used by the
   * view to highlight where the nest just landed (and where it would land on
   * undo).
   */
  flashMoveMarker?: (mapX: number, mapY: number) => void;
}

/**
 * Optimistic move of a nest to (mapX, mapY). Rolls back local state and shows
 * an error toast if the RPC fails. With `undoable: true`, surfaces an undo
 * toast that snaps the nest back to its previous position.
 */
export async function moveNest(
  nest: Nest,
  mapX: number,
  mapY: number,
  options: MoveNestOptions = {},
  deps: MoveNestDeps = defaultMoveNestDeps,
): Promise<void> {
  const previous = nest;
  deps.nests.upsert({ ...nest, mapX, mapY });
  try {
    const updated = await deps.remote.update({
      id: nest.id,
      mapX,
      mapY,
    });
    deps.nests.upsert(updated);
    if (options.undoable) {
      deps.toast?.info("Nest moved", {
        action: {
          label: "Undo",
          onClick: () => {
            options.flashMoveMarker?.(previous.mapX, previous.mapY);
            void moveNest(
              updated,
              previous.mapX,
              previous.mapY,
              { flashMoveMarker: options.flashMoveMarker },
              deps,
            );
          },
        },
      });
    }
  } catch (error) {
    log.error("Failed to move nest", { id: nest.id, error });
    deps.nests.upsert(previous);
    deps.toast?.error("Could not move nest");
    playSfx("error");
  }
}
