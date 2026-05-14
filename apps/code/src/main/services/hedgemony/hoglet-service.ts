import { inject, injectable } from "inversify";
import type { HogletRepository } from "../../db/repositories/hoglet-repository";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import {
  HedgemonyEvent,
  type HedgemonyEvents,
  type Hoglet,
  type HogletWatchEvent,
  type ListHogletsInput,
  type RecordAdhocHogletInput,
} from "./schemas";

const log = logger.scope("hoglet-service");

/** Safety cap from notes/hedgemony/backend-integration.md. */
export const MAX_WILD_HOGLETS = 25;

/**
 * Owns the `hedgemony_hoglet` sidecar invariant. Hoglet creation is anchored
 * on cloud Task creation (driven by the renderer's TaskCreationSaga); this
 * service writes only the local sidecar row + emits an event. Chat/audit
 * is intentionally not coupled here — observers narrate creation later.
 */
@injectable()
export class HogletService extends TypedEventEmitter<HedgemonyEvents> {
  constructor(
    @inject(MAIN_TOKENS.HogletRepository)
    private readonly hoglets: HogletRepository,
  ) {
    super();
  }

  list(input: ListHogletsInput): Hoglet[] {
    if (input.wildOnly) return this.hoglets.findAllWild();
    if (input.nestId) return this.hoglets.findAllForNest(input.nestId);
    throw new Error("hoglets.list requires wildOnly or nestId");
  }

  recordAdhoc(input: RecordAdhocHogletInput): Hoglet {
    const existing = this.hoglets.findByTaskId(input.taskId);
    if (existing) {
      log.warn("Adhoc hoglet already exists for taskId", {
        taskId: input.taskId,
        hogletId: existing.id,
      });
      return existing;
    }

    const wildCount = this.hoglets.countWild();
    if (wildCount >= MAX_WILD_HOGLETS) {
      throw new Error("wild_hoglet_cap_reached");
    }

    const created = this.hoglets.create({
      taskId: input.taskId,
      nestId: null,
      signalReportId: null,
    });
    log.info("Adhoc hoglet recorded", {
      id: created.id,
      taskId: created.taskId,
    });
    this.emitChange(null, { kind: "upsert", hoglet: created });
    return created;
  }

  private emitChange(nestId: string | null, event: HogletWatchEvent): void {
    this.emit(HedgemonyEvent.HogletChanged, { nestId, event });
  }
}
