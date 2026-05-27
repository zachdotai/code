import { parseGithubUrl } from "@posthog/git/utils";
import { inject, injectable } from "inversify";
import { normalizeRepoKey } from "../../../shared/utils/repo";
import type { RepositoryRepository } from "../../db/repositories/repository-repository";
import type { NestRepository } from "../../db/repositories/rts/nest-repository";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { FoldersService } from "../folders/service";
import type { GitService } from "../git/service";
import type { CloudTaskClient } from "./cloud-task-client";
import { buildLocalBootstrapHandoff } from "./local-bootstrap-handoff";
import type { NestChatService } from "./nest-chat-service";
import { findConfidentMatch } from "./repo-slug-match";
import {
  type CompactValidatedNestInput,
  type CreateNestInput,
  type HedgehogStateView,
  type MarkValidatedInput,
  type Nest,
  type NestIdInput,
  type NestMessage,
  type NestWatchEvent,
  RtsEvent,
  type RtsEvents,
  type UpdateNestInput,
} from "./schemas";
import { stringifyError } from "./utils";

const log = logger.scope("nest-service");

@injectable()
export class NestService extends TypedEventEmitter<RtsEvents> {
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
    @inject(MAIN_TOKENS.CloudTaskClient)
    private readonly cloudTasks: CloudTaskClient,
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
    const normalizedInput = normalizeCreateNestInput(input);
    const bootstrap = normalizedInput.creationBootstrap;
    let primaryRepository =
      bootstrap?.primaryRepository ??
      bootstrap?.repositories[0] ??
      this.pickFallbackPrimaryRepository();
    const originalPrimaryRepository = primaryRepository;
    primaryRepository =
      await this.validateAndCorrectRepository(primaryRepository);
    const effectiveInput =
      normalizedInput.creationBootstrap &&
      originalPrimaryRepository &&
      primaryRepository &&
      originalPrimaryRepository !== primaryRepository
        ? {
            ...normalizedInput,
            creationBootstrap: {
              ...normalizedInput.creationBootstrap,
              primaryRepository,
              repositories: normalizedInput.creationBootstrap.repositories.map(
                (repo) =>
                  repo === originalPrimaryRepository ? primaryRepository : repo,
              ),
            },
          }
        : normalizedInput;
    const created = this.nests.create({
      name: normalizedInput.name,
      goalPrompt: normalizedInput.goalPrompt,
      definitionOfDone: normalizedInput.definitionOfDone ?? null,
      mapX: normalizedInput.mapX,
      mapY: normalizedInput.mapY,
      primaryRepository,
    });
    const creationMessages = this.nestChat.recordCreationContext(
      created,
      effectiveInput,
    );
    for (const message of creationMessages) {
      this.emitMessageAppended(message);
    }
    if (
      originalPrimaryRepository &&
      primaryRepository &&
      originalPrimaryRepository !== primaryRepository
    ) {
      const message = this.nestChat.recordHedgehogMessage({
        nestId: created.id,
        kind: "audit",
        body: `Auto-corrected primary repository: "${originalPrimaryRepository}" -> "${primaryRepository}" (original slug not found in GitHub integrations).`,
        payloadJson: {
          type: "primary_repository_auto_corrected",
          originalRepository: originalPrimaryRepository,
          correctedRepository: primaryRepository,
        },
      });
      this.emitMessageAppended(message);
    }
    if (input.creationBootstrap) {
      const handoffMessage = await this.buildBootstrapHandoffMessage(
        created,
        effectiveInput,
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

  markValidated(input: MarkValidatedInput): Nest {
    const existing = this.nests.findById(input.id);
    if (!existing) {
      throw new Error(`Nest not found: ${input.id}`);
    }
    if (existing.status === "archived") {
      throw new Error("archived_nest_cannot_validate");
    }
    if (existing.status === "dormant") {
      throw new Error("dormant_nest_cannot_validate");
    }
    if (existing.status === "validated") {
      log.warn("markValidated called for already-validated nest", {
        id: existing.id,
      });
      return existing;
    }

    const validated = this.nests.update(input.id, { status: "validated" });
    if (!validated) {
      throw new Error(`Nest not found: ${input.id}`);
    }
    const validationMessage = this.nestChat.recordValidationContext(
      validated,
      input,
    );
    this.emitMessageAppended(validationMessage);
    log.info("Nest validated", { id: validated.id });
    this.emitChange(validated, { kind: "validated", nest: validated });
    return validated;
  }

  compactValidatedNest(input: CompactValidatedNestInput): Nest {
    const nest = this.nests.findById(input.id);
    if (!nest) {
      throw new Error(`Nest not found: ${input.id}`);
    }
    if (nest.status !== "validated") {
      throw new Error("nest_must_be_validated_to_compact");
    }

    const compacted = this.nests.update(input.id, { status: "dormant" });
    if (!compacted) {
      throw new Error(`Nest not found: ${input.id}`);
    }
    const compactionMessage = this.nestChat.compactValidatedNest(
      compacted,
      input,
    );
    this.emitMessageAppended(compactionMessage);
    log.info("Validated nest compacted", { id: compacted.id });
    this.emitChange(compacted, { kind: "status", nest: compacted });
    return compacted;
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
    this.emit(RtsEvent.NestChanged, {
      nestId: message.nestId,
      event: { kind: "message_appended", message },
    });
  }

  /**
   * Emitted by HedgehogTickService at tick boundaries. Drives the
   * "ticking" sprite glow in the renderer.
   */
  emitHedgehogTick(nestId: string, state: HedgehogStateView): void {
    this.emit(RtsEvent.NestChanged, {
      nestId,
      event: { kind: "hedgehog_tick", state },
    });
  }

  private emitChange(nest: Nest, event: NestWatchEvent): void {
    this.emit(RtsEvent.NestChanged, { nestId: nest.id, event });
  }

  private async validateAndCorrectRepository(
    slug: string | null,
  ): Promise<string | null> {
    if (!slug) return slug;

    try {
      const integration =
        await this.cloudTasks.resolveGithubUserIntegration(slug);
      if (integration) return slug;

      const accessibleRepositories =
        await this.cloudTasks.listAccessibleRepositorySlugs();
      return findConfidentMatch(slug, accessibleRepositories) ?? slug;
    } catch (error) {
      log.warn("Repository validation failed during nest creation", {
        repository: slug,
        error: stringifyError(error),
      });
      return slug;
    }
  }

  /**
   * Best-effort fallback used when nest creation doesn't carry a bootstrap
   * context. Picks the operator's most-recently-accessed local repository so
   * the hedgehog isn't left guessing which repo to scope its hoglets to.
   * Returns null when no repository has a usable remote URL.
   */
  private pickFallbackPrimaryRepository(): string | null {
    let recent: Awaited<
      ReturnType<RepositoryRepository["findMostRecentlyAccessed"]>
    >;
    try {
      recent = this.repositories.findMostRecentlyAccessed();
    } catch (error) {
      log.warn("findMostRecentlyAccessed failed; no fallback repo", {
        error: stringifyError(error),
      });
      return null;
    }
    const remote = recent?.remoteUrl;
    if (!remote) return null;
    const parsed = parseGithubUrl(remote);
    if (parsed && parsed.kind === "repo") {
      return `${parsed.owner}/${parsed.repo}`;
    }
    const normalised = normalizeRepoKey(remote);
    return normalised.includes("/") ? normalised : null;
  }

  private async buildBootstrapHandoffMessage(
    nest: Nest,
    input: CreateNestInput,
  ): Promise<NestMessage> {
    if (!input.creationBootstrap) {
      throw new Error("creation_bootstrap_missing");
    }

    try {
      return this.nestChat.recordBootstrapHandoff(
        await buildLocalBootstrapHandoff(
          nest.id,
          input.creationBootstrap,
          this.repositories.findAll(),
          {
            cloneRepository: (repoUrl, targetPath) =>
              this.git
                .cloneRepository(
                  repoUrl,
                  targetPath,
                  `rts-bootstrap-${nest.id}`,
                )
                .then(() => undefined),
            registerFolder: (folderPath, remoteUrl) =>
              this.folders.addFolder(folderPath, { remoteUrl }),
          },
        ),
      );
    } catch (error) {
      const errorMessage = stringifyError(error);
      log.warn("Local bootstrap handoff failed during nest creation", {
        nestId: nest.id,
        error: errorMessage,
      });
      return this.nestChat.recordBootstrapHandoffFailure(
        nest,
        input,
        errorMessage,
      );
    }
  }
}

function normalizeCreateNestInput(input: CreateNestInput): CreateNestInput {
  if (goalPromptHasUserStories(input.goalPrompt)) {
    return input;
  }
  return {
    ...input,
    goalPrompt: buildGoalPromptWithUserStories(input.goalPrompt),
  };
}

function goalPromptHasUserStories(goalPrompt: string): boolean {
  return /^#{1,6}\s+user stories\s*$/im.test(goalPrompt);
}

function buildGoalPromptWithUserStories(goalPrompt: string): string {
  const trimmed = goalPrompt.trim();
  const storyGoal = summarizeForUserStory(trimmed);
  return [
    "## Summary",
    trimmed,
    "## User Stories",
    `- P1: As an operator, I want the nest to deliver this goal: ${storyGoal}, so that the requested outcome is completed and validated.`,
  ].join("\n\n");
}

function summarizeForUserStory(goalPrompt: string): string {
  const singleLine = goalPrompt.replace(/\s+/g, " ").trim();
  if (singleLine.length <= 240) return singleLine;
  return `${singleLine.slice(0, 237).trimEnd()}...`;
}
