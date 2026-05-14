import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("../settingsStore", () => ({
  getWorktreeLocation: () => "/tmp/posthog-code-worktrees",
}));

import type { NestRepository } from "../../db/repositories/nest-repository";
import type { RepositoryRepository } from "../../db/repositories/repository-repository";
import type { FoldersService } from "../folders/service";
import type { GitService } from "../git/service";
import type { CloudTaskClient } from "./cloud-task-client";
import type { NestChatService } from "./nest-chat-service";
import { NestService } from "./nest-service";
import { HedgemonyEvent, type Nest, type NestMessage } from "./schemas";

type NestPatch = Parameters<NestRepository["update"]>[1];
type CreateNestData = Parameters<NestRepository["create"]>[0];

function makeNest(overrides: Partial<Nest> = {}): Nest {
  const now = "2026-05-13T00:00:00.000Z";
  return {
    id: crypto.randomUUID(),
    name: "Checkout lift",
    goalPrompt: "Improve checkout conversion",
    definitionOfDone: null,
    mapX: 0,
    mapY: 0,
    status: "active",
    health: "ok",
    targetMetricId: null,
    loadoutJson: "{}",
    primaryRepository: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createMockNestRepository() {
  const nests = new Map<string, Nest>();

  const repo = {
    _nests: nests,
    findById: vi.fn((id: string) => nests.get(id) ?? null),
    findAll: vi.fn(() => [...nests.values()]),
    findAllVisible: vi.fn(() =>
      [...nests.values()].filter((nest) => nest.status !== "archived"),
    ),
    create: vi.fn((data: CreateNestData) => {
      const nest = makeNest({
        ...data,
        definitionOfDone: data.definitionOfDone ?? null,
      });
      nests.set(nest.id, nest);
      return nest;
    }),
    update: vi.fn((id: string, data: NestPatch) => {
      const existing = nests.get(id);
      if (!existing) return null;
      const updated = {
        ...existing,
        ...data,
        updatedAt: new Date().toISOString(),
      };
      nests.set(id, updated);
      return updated;
    }),
    archive: vi.fn((id: string) => repo.update(id, { status: "archived" })),
    unarchive: vi.fn((id: string) => repo.update(id, { status: "active" })),
  };

  return repo as typeof repo & NestRepository;
}

function makeMessage(overrides: Partial<NestMessage> = {}): NestMessage {
  return {
    id: crypto.randomUUID(),
    nestId: "nest-1",
    kind: "audit",
    visibility: "summary",
    sourceTaskId: null,
    body: "msg",
    payloadJson: null,
    createdAt: "2026-05-13T00:00:00.000Z",
    ...overrides,
  };
}

function createMockNestChatService() {
  return {
    recordCreationContext: vi.fn(() => [makeMessage(), makeMessage()]),
    recordBootstrapHandoff: vi.fn(() => makeMessage()),
    recordBootstrapHandoffFailure: vi.fn(() => makeMessage()),
    recordValidationContext: vi.fn(() => makeMessage()),
    compactValidatedNest: vi.fn(() => makeMessage()),
    recordHedgehogMessage: vi.fn(() => makeMessage()),
  } as unknown as NestChatService & {
    recordCreationContext: ReturnType<typeof vi.fn>;
    recordBootstrapHandoff: ReturnType<typeof vi.fn>;
    recordBootstrapHandoffFailure: ReturnType<typeof vi.fn>;
    recordValidationContext: ReturnType<typeof vi.fn>;
    compactValidatedNest: ReturnType<typeof vi.fn>;
    recordHedgehogMessage: ReturnType<typeof vi.fn>;
  };
}

function createMockRepositoryRepository() {
  return {
    findAll: vi.fn(() => [
      {
        id: "repo-1",
        path: "/tmp/posthog",
        remoteUrl: "https://github.com/posthog/posthog.git",
        lastAccessedAt: null,
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T00:00:00.000Z",
      },
    ]),
    findMostRecentlyAccessed: vi.fn(() => null),
  } as unknown as RepositoryRepository & {
    findAll: ReturnType<typeof vi.fn>;
    findMostRecentlyAccessed: ReturnType<typeof vi.fn>;
  };
}

function createMockGitService() {
  return {
    cloneRepository: vi.fn().mockResolvedValue({ cloneId: "clone-1" }),
  } as unknown as GitService & {
    cloneRepository: ReturnType<typeof vi.fn>;
  };
}

function createMockFoldersService() {
  return {
    addFolder: vi.fn(async (folderPath: string, options = {}) => ({
      id: "repo-cloned",
      path: folderPath,
      remoteUrl: "remoteUrl" in options ? options.remoteUrl : null,
      lastAccessedAt: null,
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
    })),
  } as unknown as FoldersService & {
    addFolder: ReturnType<typeof vi.fn>;
  };
}

function createMockCloudTaskClient() {
  return {
    resolveGithubUserIntegration: vi.fn(async () => "integration-1"),
    listAccessibleRepositorySlugs: vi.fn(async () => []),
  } as unknown as CloudTaskClient & {
    resolveGithubUserIntegration: ReturnType<typeof vi.fn>;
    listAccessibleRepositorySlugs: ReturnType<typeof vi.fn>;
  };
}

describe("NestService", () => {
  let nestRepository: ReturnType<typeof createMockNestRepository>;
  let nestChat: ReturnType<typeof createMockNestChatService>;
  let repositoryRepository: ReturnType<typeof createMockRepositoryRepository>;
  let git: ReturnType<typeof createMockGitService>;
  let folders: ReturnType<typeof createMockFoldersService>;
  let cloudTasks: ReturnType<typeof createMockCloudTaskClient>;
  let service: NestService;

  beforeEach(() => {
    nestRepository = createMockNestRepository();
    nestChat = createMockNestChatService();
    repositoryRepository = createMockRepositoryRepository();
    git = createMockGitService();
    folders = createMockFoldersService();
    cloudTasks = createMockCloudTaskClient();
    service = new NestService(
      nestRepository,
      nestChat,
      repositoryRepository,
      git,
      folders,
      cloudTasks,
    );
  });

  it("creates a nest, records creation context, and emits a CRUD watch event", async () => {
    const listener = vi.fn();
    service.on(HedgemonyEvent.NestChanged, listener);

    const input = {
      name: "Checkout lift",
      goalPrompt: "Improve checkout conversion",
      definitionOfDone: "Conversion improves and docs are updated",
      mapX: 42,
      mapY: -7,
      creationMode: "guided" as const,
    };

    const nest = await service.create(input);

    expect(nestRepository.create).toHaveBeenCalledWith({
      name: input.name,
      goalPrompt: input.goalPrompt,
      definitionOfDone: input.definitionOfDone,
      mapX: input.mapX,
      mapY: input.mapY,
      primaryRepository: null,
    });
    expect(nestChat.recordCreationContext).toHaveBeenCalledWith(nest, input);
    expect(nest).toMatchObject({
      name: "Checkout lift",
      goalPrompt: "Improve checkout conversion",
      definitionOfDone: "Conversion improves and docs are updated",
      mapX: 42,
      mapY: -7,
      status: "active",
      health: "ok",
      loadoutJson: "{}",
    });
    expect(listener).toHaveBeenCalledWith({
      nestId: nest.id,
      event: { kind: "status", nest },
    });
  });

  it("falls back to the most-recently-accessed repository when no bootstrap is provided", async () => {
    repositoryRepository.findMostRecentlyAccessed.mockReturnValue({
      id: "repo-recent",
      path: "/tmp/posthog",
      remoteUrl: "https://github.com/posthog/posthog.git",
      lastAccessedAt: "2026-05-13T00:00:00.000Z",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
    });

    await service.create({
      name: "Quick nest",
      goalPrompt: "Add a feature",
      definitionOfDone: null,
      mapX: 0,
      mapY: 0,
      creationMode: "simple",
    });

    expect(nestRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ primaryRepository: "posthog/posthog" }),
    );
  });

  it("prefers bootstrap primaryRepository over the most-recently-accessed fallback", async () => {
    repositoryRepository.findMostRecentlyAccessed.mockReturnValue({
      id: "repo-recent",
      path: "/tmp/elsewhere",
      remoteUrl: "https://github.com/posthog/other.git",
      lastAccessedAt: "2026-05-13T00:00:00.000Z",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
    });

    await service.create({
      name: "Bootstrapped",
      goalPrompt: "Work on a specific repo",
      definitionOfDone: null,
      mapX: 0,
      mapY: 0,
      creationMode: "guided",
      creationBootstrap: {
        mode: "agent_bootstrap",
        repositories: ["posthog/posthog"],
        primaryRepository: "posthog/posthog",
        prompt: "go",
        handoffInstructions: "ok",
      },
    });

    expect(nestRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ primaryRepository: "posthog/posthog" }),
    );
  });

  it("auto-corrects a missing primaryRepository when GitHub has a confident match", async () => {
    cloudTasks.resolveGithubUserIntegration.mockResolvedValue(null);
    cloudTasks.listAccessibleRepositorySlugs.mockResolvedValue([
      "Brooker-Fam/nexus-games",
    ]);

    const nest = await service.create({
      name: "Bootstrapped",
      goalPrompt: "Work on a specific repo",
      definitionOfDone: null,
      mapX: 0,
      mapY: 0,
      creationMode: "guided",
      creationBootstrap: {
        mode: "agent_bootstrap",
        repositories: ["Brooker-Fam/nexus-game"],
        primaryRepository: "Brooker-Fam/nexus-game",
        prompt: "go",
        handoffInstructions: "ok",
      },
    });

    expect(nestRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryRepository: "Brooker-Fam/nexus-games",
      }),
    );
    expect(nestChat.recordHedgehogMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        nestId: nest.id,
        kind: "audit",
        body: expect.stringContaining(
          '"Brooker-Fam/nexus-game" -> "Brooker-Fam/nexus-games"',
        ),
      }),
    );
  });

  it("leaves a valid primaryRepository unchanged", async () => {
    await service.create({
      name: "Bootstrapped",
      goalPrompt: "Work on a specific repo",
      definitionOfDone: null,
      mapX: 0,
      mapY: 0,
      creationMode: "guided",
      creationBootstrap: {
        mode: "agent_bootstrap",
        repositories: ["posthog/posthog"],
        primaryRepository: "posthog/posthog",
        prompt: "go",
        handoffInstructions: "ok",
      },
    });

    expect(cloudTasks.listAccessibleRepositorySlugs).not.toHaveBeenCalled();
    expect(nestRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ primaryRepository: "posthog/posthog" }),
    );
    expect(nestChat.recordHedgehogMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "primary_repository_auto_corrected",
        }),
      }),
    );
  });

  it("keeps the original primaryRepository when validation fails", async () => {
    cloudTasks.resolveGithubUserIntegration.mockRejectedValue(
      new Error("api unavailable"),
    );

    await service.create({
      name: "Bootstrapped",
      goalPrompt: "Work on a specific repo",
      definitionOfDone: null,
      mapX: 0,
      mapY: 0,
      creationMode: "guided",
      creationBootstrap: {
        mode: "agent_bootstrap",
        repositories: ["Brooker-Fam/nexus-game"],
        primaryRepository: "Brooker-Fam/nexus-game",
        prompt: "go",
        handoffInstructions: "ok",
      },
    });

    expect(nestRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryRepository: "Brooker-Fam/nexus-game",
      }),
    );
  });

  it("leaves primaryRepository null when no bootstrap and no local repos exist", async () => {
    repositoryRepository.findMostRecentlyAccessed.mockReturnValue(null);

    await service.create({
      name: "Empty",
      goalPrompt: "do something",
      definitionOfDone: null,
      mapX: 0,
      mapY: 0,
      creationMode: "simple",
    });

    expect(nestRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ primaryRepository: null }),
    );
    expect(cloudTasks.resolveGithubUserIntegration).not.toHaveBeenCalled();
  });

  it("records a local bootstrap handoff when creation includes bootstrap context", async () => {
    const nest = await service.create({
      name: "Explore repo",
      goalPrompt: "Explore local repo",
      definitionOfDone: "Repo context captured",
      mapX: 42,
      mapY: -7,
      creationMode: "guided",
      creationBootstrap: {
        mode: "agent_bootstrap",
        repositories: ["posthog/posthog"],
        primaryRepository: "posthog/posthog",
        prompt: "Inspect the repo and produce a handoff.",
        handoffInstructions: "Persist the handoff.",
      },
    });

    expect(repositoryRepository.findAll).toHaveBeenCalled();
    expect(nestChat.recordBootstrapHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        nestId: nest.id,
        taskId: `local-bootstrap:${nest.id}`,
        repositories: ["posthog/posthog"],
        primaryRepository: "posthog/posthog",
        handoffMarkdown: expect.stringContaining(
          "Local-only bootstrap handoff captured during nest creation",
        ),
      }),
    );
  });

  it("clones a referenced org/repo when it is not already local", async () => {
    repositoryRepository.findAll.mockReturnValue([]);

    const nest = await service.create({
      name: "Explore repo",
      goalPrompt: "Explore missing local repo",
      definitionOfDone: "Repo context captured",
      mapX: 42,
      mapY: -7,
      creationMode: "guided",
      creationBootstrap: {
        mode: "agent_bootstrap",
        repositories: ["Brooker-Fam/nexus-game"],
        primaryRepository: "Brooker-Fam/nexus-game",
        prompt: "Inspect the repo and produce a handoff.",
        handoffInstructions: "Persist the handoff.",
      },
    });

    expect(git.cloneRepository).toHaveBeenCalledWith(
      "https://github.com/Brooker-Fam/nexus-game.git",
      expect.stringContaining("Brooker-Fam/nexus-game"),
      `hedgemony-bootstrap-${nest.id}`,
    );
    expect(folders.addFolder).toHaveBeenCalledWith(
      expect.stringContaining("Brooker-Fam/nexus-game"),
      { remoteUrl: "Brooker-Fam/nexus-game" },
    );
    expect(nestChat.recordBootstrapHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        nestId: nest.id,
        outputJson: expect.objectContaining({
          mode: "local_bootstrap",
        }),
        handoffMarkdown: expect.stringContaining(
          "cloned into local PostHog Code storage",
        ),
      }),
    );
  });

  it("keeps the nest and records degraded bootstrap context when handoff fails", async () => {
    repositoryRepository.findAll.mockImplementationOnce(() => {
      throw new Error("db_down");
    });
    const listener = vi.fn();
    service.on(HedgemonyEvent.NestChanged, listener);

    const nest = await service.create({
      name: "Explore repo",
      goalPrompt: "Explore missing local repo",
      definitionOfDone: "Repo context captured",
      mapX: 42,
      mapY: -7,
      creationMode: "guided",
      creationBootstrap: {
        mode: "agent_bootstrap",
        repositories: ["Brooker-Fam/nexus-game"],
        primaryRepository: "Brooker-Fam/nexus-game",
        prompt: "Inspect the repo and produce a handoff.",
        handoffInstructions: "Persist the handoff.",
      },
    });

    expect(service.get({ id: nest.id })).toEqual(nest);
    expect(nestChat.recordBootstrapHandoff).not.toHaveBeenCalled();
    expect(nestChat.recordBootstrapHandoffFailure).toHaveBeenCalledWith(
      nest,
      expect.objectContaining({ name: "Explore repo" }),
      expect.stringContaining("db_down"),
    );
    expect(listener).toHaveBeenCalledWith({
      nestId: nest.id,
      event: { kind: "status", nest },
    });
  });

  it("updates nest fields without recreating the row", async () => {
    const nest = await service.create({
      name: "Original",
      goalPrompt: "Original goal",
      mapX: 1,
      mapY: 2,
    });

    const updated = service.update({
      id: nest.id,
      name: "Renamed",
      goalPrompt: "Sharper goal",
      definitionOfDone: "Merged PRs cover the path",
      mapX: 10,
      mapY: 20,
    });

    expect(updated.id).toBe(nest.id);
    expect(updated).toMatchObject({
      name: "Renamed",
      goalPrompt: "Sharper goal",
      definitionOfDone: "Merged PRs cover the path",
      mapX: 10,
      mapY: 20,
    });
    expect(nestRepository.create).toHaveBeenCalledTimes(1);
    expect(service.get({ id: nest.id })).toEqual(updated);
  });

  it("archives by status, hides archived nests from list, and keeps history queryable", async () => {
    const keep = await service.create({
      name: "Keep",
      goalPrompt: "Keep active",
      mapX: 0,
      mapY: 0,
    });
    const archive = await service.create({
      name: "Archive",
      goalPrompt: "Archive this",
      mapX: 1,
      mapY: 1,
    });

    const archived = service.archive({ id: archive.id });

    expect(archived.status).toBe("archived");
    expect(service.list().map((nest) => nest.id)).toEqual([keep.id]);
    expect(service.get({ id: archive.id })).toMatchObject({
      id: archive.id,
      status: "archived",
    });
  });

  it("unarchives a soft-archived nest", async () => {
    const nest = await service.create({
      name: "Archive",
      goalPrompt: "Archive this",
      mapX: 1,
      mapY: 1,
    });
    service.archive({ id: nest.id });

    expect(service.unarchive({ id: nest.id })).toMatchObject({
      id: nest.id,
      status: "active",
    });
  });

  it("validates an active nest and records the validation context", async () => {
    const listener = vi.fn();
    service.on(HedgemonyEvent.NestChanged, listener);
    const nest = await service.create({
      name: "Checkout",
      goalPrompt: "Improve checkout",
      mapX: 1,
      mapY: 1,
    });

    const validated = service.markValidated({
      id: nest.id,
      summary: "Merged checkout fixes and verified the happy path.",
      prUrls: ["https://github.com/posthog/posthog/pull/1"],
      taskIds: ["task-1"],
    });

    expect(validated.status).toBe("validated");
    expect(nestChat.recordValidationContext).toHaveBeenCalledWith(validated, {
      id: nest.id,
      summary: "Merged checkout fixes and verified the happy path.",
      prUrls: ["https://github.com/posthog/posthog/pull/1"],
      taskIds: ["task-1"],
    });
    expect(listener).toHaveBeenLastCalledWith({
      nestId: nest.id,
      event: { kind: "validated", nest: validated },
    });
  });

  it("does not record duplicate validation context for validated nests", async () => {
    const nest = await service.create({
      name: "Checkout",
      goalPrompt: "Improve checkout",
      mapX: 1,
      mapY: 1,
    });
    const validated = service.markValidated({ id: nest.id, summary: "Done" });
    const listener = vi.fn();
    service.on(HedgemonyEvent.NestChanged, listener);

    const repeated = service.markValidated({
      id: nest.id,
      summary: "Done again",
    });

    expect(repeated).toEqual(validated);
    expect(nestChat.recordValidationContext).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("rejects markValidated on dormant nests", async () => {
    const nest = await service.create({
      name: "Already shipped",
      goalPrompt: "Done",
      mapX: 1,
      mapY: 1,
    });
    const validated = service.markValidated({ id: nest.id, summary: "Done" });
    service.compactValidatedNest({ id: validated.id });

    expect(() =>
      service.markValidated({ id: nest.id, summary: "Encore" }),
    ).toThrowError("dormant_nest_cannot_validate");
  });

  it("compacts only validated nests, transitioning them to dormant", async () => {
    const active = await service.create({
      name: "Active",
      goalPrompt: "Still working",
      mapX: 1,
      mapY: 1,
    });

    expect(() => service.compactValidatedNest({ id: active.id })).toThrowError(
      "nest_must_be_validated_to_compact",
    );

    const validated = service.markValidated({
      id: active.id,
      summary: "Done",
    });
    const dormant = service.compactValidatedNest({
      id: validated.id,
      reason: "Clean up old context.",
    });

    expect(dormant.status).toBe("dormant");
    expect(nestChat.compactValidatedNest).toHaveBeenCalledWith(dormant, {
      id: dormant.id,
      reason: "Clean up old context.",
    });
    expect(service.get({ id: dormant.id })).toMatchObject({
      id: dormant.id,
      status: "dormant",
    });
  });

  it("throws when a nest lookup or mutation misses", () => {
    expect(() => service.get({ id: "missing" })).toThrowError(
      "Nest not found: missing",
    );
    expect(() => service.update({ id: "missing", name: "Nope" })).toThrowError(
      "Nest not found: missing",
    );
    expect(() => service.archive({ id: "missing" })).toThrowError(
      "Nest not found: missing",
    );
    expect(() => service.unarchive({ id: "missing" })).toThrowError(
      "Nest not found: missing",
    );
    expect(() =>
      service.markValidated({ id: "missing", summary: "Done" }),
    ).toThrowError("Nest not found: missing");
    expect(() => service.compactValidatedNest({ id: "missing" })).toThrowError(
      "Nest not found: missing",
    );
  });
});
