import { inject, injectable } from "inversify";
import type { NestRepository } from "../../db/repositories/nest-repository";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import {
  type CreateNestInput,
  HedgemonyEvent,
  type HedgemonyEvents,
  type Nest,
  type NestIdInput,
  type NestWatchEvent,
  type UpdateNestInput,
} from "./schemas";

const log = logger.scope("nest-service");

@injectable()
export class NestService extends TypedEventEmitter<HedgemonyEvents> {
  constructor(
    @inject(MAIN_TOKENS.NestRepository)
    private readonly nests: NestRepository,
  ) {
    super();
  }

  list(): Nest[] {
    return this.nests.findAllVisible();
  }

  get(input: NestIdInput): Nest {
    const found = this.nests.findById(input.id);
    if (!found) {
      throw new Error(`Nest not found: ${input.id}`);
    }
    return found;
  }

  create(input: CreateNestInput): Nest {
    const created = this.nests.create(input);
    log.info("Nest created", { id: created.id, name: created.name });
    this.emitChange(created, { kind: "status", nest: created });
    return created;
  }

  update(input: UpdateNestInput): Nest {
    const { id, ...patch } = input;
    const updated = this.nests.update(id, patch);
    if (!updated) {
      throw new Error(`Nest not found: ${id}`);
    }
    this.emitChange(updated, { kind: "status", nest: updated });
    return updated;
  }

  archive(input: NestIdInput): Nest {
    const archived = this.nests.archive(input.id);
    if (!archived) {
      throw new Error(`Nest not found: ${input.id}`);
    }
    log.info("Nest archived", { id: archived.id });
    this.emitChange(archived, { kind: "archived", nest: archived });
    return archived;
  }

  unarchive(input: NestIdInput): Nest {
    const restored = this.nests.unarchive(input.id);
    if (!restored) {
      throw new Error(`Nest not found: ${input.id}`);
    }
    log.info("Nest unarchived", { id: restored.id });
    this.emitChange(restored, { kind: "status", nest: restored });
    return restored;
  }

  private emitChange(nest: Nest, event: NestWatchEvent): void {
    this.emit(HedgemonyEvent.NestChanged, { nestId: nest.id, event });
  }
}
