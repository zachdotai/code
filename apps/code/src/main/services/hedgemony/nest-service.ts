import { inject, injectable } from "inversify";
import type { NestRepository } from "../../db/repositories/nest-repository";
import type { RepositoryRepository } from "../../db/repositories/repository-repository";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { FoldersService } from "../folders/service";
import type { GitService } from "../git/service";
import { buildLocalBootstrapHandoff } from "./local-bootstrap-handoff";
import type { NestChatService } from "./nest-chat-service";
import {
  type CompleteNestInput,
  type CreateNestInput,
  type ForgetCompletedNestContextInput,
  type HedgehogStateView,
  HedgemonyEvent,
  type HedgemonyEvents,
  type Nest,
  type NestIdInput,
  type NestMessage,
  type NestWatchEvent,
  type UpdateNestInput,
} from "./schemas";

const log = logger.scope("nest-service");

@injectable()
export class NestService extends TypedEventEmitter<HedgemonyEvents> {
  constructor(
    @inject(MAIN_TOKENS.NestRepository)
    private readonly nests: NestRepository,
    @inject(MAIN_TOKENS.NestChatService)
    private readonly nestChat: NestChatService,
    @inject(MAIN_TOKENS.RepositoryRepository)
    private readonly repositories: RepositoryRepository,
    @inject(MAIN_TOKENS.GitService)
    private readonly git: GitService,
    @inject(MAIN_TOKENS.FoldersService)
    private readonly folders: FoldersService,
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

  async create(input: CreateNestInput): Promise<Nest> {
    const created = this.nests.create({
      name: input.name,
      goalPrompt: input.goalPrompt,
      definitionOfDone: input.definitionOfDone ?? null,
      mapX: input.mapX,
      mapY: input.mapY,
    });
    const creationMessages = this.nestChat.recordCreationContext(
      created,
      input,
    );
    for (const message of creationMessages) {
      this.emitMessageAppended(message);
    }
    if (input.creationBootstrap) {
      const handoffMessage = this.nestChat.recordBootstrapHandoff(
        await buildLocalBootstrapHandoff(
          created.id,
          input.creationBootstrap,
          this.repositories.findAll(),
          {
            cloneRepository: (repoUrl, targetPath) =>
              this.git
                .cloneRepository(
                  repoUrl,
                  targetPath,
                  `hedgemony-bootstrap-${created.id}`,
                )
                .then(() => undefined),
            registerFolder: (folderPath, remoteUrl) =>
              this.folders.addFolder(folderPath, { remoteUrl }),
          },
        ),
      );
      this.emitMessageAppended(handoffMessage);
    }
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

  complete(input: CompleteNestInput): Nest {
    const existing = this.nests.findById(input.id);
    if (!existing) {
      throw new Error(`Nest not found: ${input.id}`);
    }
    if (existing.status === "archived") {
      throw new Error("archived_nest_cannot_complete");
    }

    const completed = this.nests.update(input.id, { status: "dormant" });
    if (!completed) {
      throw new Error(`Nest not found: ${input.id}`);
    }
    const completionMessage = this.nestChat.recordCompletionContext(
      completed,
      input,
    );
    this.emitMessageAppended(completionMessage);
    log.info("Nest completed", { id: completed.id });
    this.emitChange(completed, { kind: "completed", nest: completed });
    return completed;
  }

  forgetCompletedContext(input: ForgetCompletedNestContextInput): Nest {
    const nest = this.nests.findById(input.id);
    if (!nest) {
      throw new Error(`Nest not found: ${input.id}`);
    }
    if (nest.status !== "dormant") {
      throw new Error("nest_must_be_dormant_to_forget_context");
    }

    const forgetMessage = this.nestChat.forgetCompletedContext(nest, input);
    this.emitMessageAppended(forgetMessage);
    log.info("Completed nest context forgotten", { id: nest.id });
    this.emitChange(nest, { kind: "status", nest });
    return nest;
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

  /**
   * Public emit helper used by services that write to nest chat outside the
   * NestService body (the new `nestChat.send` mutation, HedgehogTickService).
   * Centralizes the wrap-into-NestWatchEvent step so subscribers stay on a
   * single channel.
   */
  emitMessageAppended(message: NestMessage): void {
    this.emit(HedgemonyEvent.NestChanged, {
      nestId: message.nestId,
      event: { kind: "message_appended", message },
    });
  }

  /**
   * Emitted by HedgehogTickService at tick boundaries. Drives the
   * "ticking" sprite glow in the renderer.
   */
  emitHedgehogTick(nestId: string, state: HedgehogStateView): void {
    this.emit(HedgemonyEvent.NestChanged, {
      nestId,
      event: { kind: "hedgehog_tick", state },
    });
  }

  private emitChange(nest: Nest, event: NestWatchEvent): void {
    this.emit(HedgemonyEvent.NestChanged, { nestId: nest.id, event });
  }
}
