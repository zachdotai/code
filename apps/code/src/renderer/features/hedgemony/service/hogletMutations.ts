import type { Hoglet } from "@main/services/hedgemony/schemas";
import { trpcClient } from "@renderer/trpc/client";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { toast } from "sonner";
import { sonnerToastSink } from "../adapters/sonnerToastSink";
import { trpcHogletRemoteService } from "../adapters/trpcHogletRemoteService";
import { zustandHogletPositionRepository } from "../adapters/zustandHogletPositionRepository";
import { zustandHogletRepository } from "../adapters/zustandHogletRepository";
import { zustandNestRepository } from "../adapters/zustandNestRepository";
import { WILD_BUCKET } from "../constants/buckets";
import type { HogletPositionRepository } from "../domain/HogletPositionRepository";
import type { HogletRemoteService } from "../domain/HogletRemoteService";
import type { HogletRepository } from "../domain/HogletRepository";
import type { NestRepository } from "../domain/NestRepository";
import type { ToastSink } from "../domain/ToastSink";
import { useHogletPositionStore } from "../stores/hogletPositionStore";
import { useHogletStore } from "../stores/hogletStore";

const log = logger.scope("hoglet-mutations");

export interface HogletMutationDeps {
  hoglets: HogletRepository;
  nests?: NestRepository;
  positions: HogletPositionRepository;
  remote: HogletRemoteService;
  toast?: ToastSink;
}

export const defaultHogletMutationDeps: HogletMutationDeps = {
  hoglets: zustandHogletRepository,
  nests: zustandNestRepository,
  positions: zustandHogletPositionRepository,
  remote: trpcHogletRemoteService,
  toast: sonnerToastSink,
};

export interface HogletDragSource {
  type?: string;
  hogletId?: string;
  sourceNestId?: string | null;
}

export interface HogletDragTarget {
  type?: string;
  nestId?: string;
}

/**
 * Optimistic move from wild into a nest. Snaps the hoglet's standalone
 * position override so it joins the nest's orbit. Rolls back the bucket
 * move on RPC failure. Works the same for ad-hoc and signal-backed wild
 * hoglets since they share a bucket.
 */
export async function adoptHoglet(
  hogletId: string,
  nestId: string,
  trackSource: "wild" | "signal",
  deps: HogletMutationDeps = defaultHogletMutationDeps,
): Promise<void> {
  const original = deps.hoglets.findInBucket(WILD_BUCKET, hogletId);
  if (!original) {
    log.warn("Adopt: source hoglet not found in wild bucket", { hogletId });
    return;
  }

  const optimistic: Hoglet = {
    ...original,
    nestId,
    updatedAt: new Date().toISOString(),
  };
  deps.hoglets.remove(WILD_BUCKET, hogletId);
  deps.hoglets.upsert(nestId, optimistic);
  deps.positions.clearPosition(hogletId);

  try {
    const updated = await deps.remote.adopt({ hogletId, nestId });
    deps.hoglets.upsert(nestId, updated);
    track(ANALYTICS_EVENTS.HEDGEMONY_HOGLET_ADOPTED, { source: trackSource });
  } catch (error) {
    log.error("Failed to adopt hoglet", { hogletId, nestId, error });
    deps.hoglets.remove(nestId, hogletId);
    deps.hoglets.upsert(WILD_BUCKET, original);
    deps.toast?.error("Could not adopt hoglet");
  }
}

/**
 * Optimistic move from a nest bucket back to wild. Both ad-hoc and
 * signal-backed nest hoglets return to the same wild bucket on release.
 * Rolls back on RPC failure.
 */
export async function releaseHoglet(
  hogletId: string,
  sourceNestId: string,
): Promise<void> {
  const store = useHogletStore.getState();
  const original = store.byBucket[sourceNestId]?.find((h) => h.id === hogletId);
  if (!original) {
    log.warn("Release: source hoglet not found in nest bucket", {
      hogletId,
      sourceNestId,
    });
    return;
  }

  const optimistic: Hoglet = {
    ...original,
    nestId: null,
    updatedAt: new Date().toISOString(),
  };
  store.remove(sourceNestId, hogletId);
  store.upsert(WILD_BUCKET, optimistic);
  useHogletPositionStore.getState().clearPosition(hogletId);

  try {
    const updated = await trpcClient.hedgemony.hoglets.release.mutate({
      hogletId,
    });
    useHogletStore.getState().upsert(WILD_BUCKET, updated);
    track(ANALYTICS_EVENTS.HEDGEMONY_HOGLET_RELEASED, { source: "nest" });
  } catch (error) {
    log.error("Failed to release hoglet", {
      hogletId,
      sourceNestId,
      error,
    });
    const current = useHogletStore.getState();
    current.remove(WILD_BUCKET, hogletId);
    current.upsert(sourceNestId, original);
    toast.error("Could not release hoglet");
  }
}

/**
 * Resolves a hoglet drag-end into a mutation:
 * - dragging onto a nest adopts a wild hoglet (nest→nest direct transfer is
 *   still rejected at the service level, so the operator must release first)
 * - dragging onto "wild" releases a nest-held hoglet back to the wild bucket
 */
export function handleHogletDrop(
  source: HogletDragSource | undefined,
  target: HogletDragTarget | undefined,
): void {
  if (
    !source ||
    source.type !== "hoglet" ||
    typeof source.hogletId !== "string"
  ) {
    return;
  }
  const { hogletId, sourceNestId = null } = source;

  if (target?.type === "nest" && target.nestId) {
    if (sourceNestId !== null) {
      toast.error("Release this hoglet to wild before adopting it elsewhere");
      return;
    }
    const original = useHogletStore
      .getState()
      .byBucket[WILD_BUCKET]?.find((h) => h.id === hogletId);
    const adoptedFrom: "wild" | "signal" =
      original?.signalReportId != null ? "signal" : "wild";
    void adoptHoglet(hogletId, target.nestId, adoptedFrom);
    return;
  }

  if (target?.type === "wild") {
    if (sourceNestId === null) return;
    void releaseHoglet(hogletId, sourceNestId);
  }
}
