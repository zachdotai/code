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
    recordCompletionContext: vi.fn(() => makeMessage()),
    forgetCompletedContext: vi.fn(() => makeMessage()),
  } as unknown as NestChatService & {
    recordCreationContext: ReturnType<typeof vi.fn>;
    recordBootstrapHandoff: ReturnType<typeof vi.fn>;
    recordCompletionContext: ReturnType<typeof vi.fn>;
    forgetCompletedContext: ReturnType<typeof vi.fn>;
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
  } as unknown as RepositoryRepository & {
    findAll: ReturnType<typeof vi.fn>;
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

describe("NestService", () => {
  let nestRepository: ReturnType<typeof createMockNestRepository>;
  let nestChat: ReturnType<typeof createMockNestChatService>;
  let repositoryRepository: ReturnType<typeof createMockRepositoryRepository>;
  let git: ReturnType<typeof createMockGitService>;
  let folders: ReturnType<typeof createMockFoldersService>;
  let service: NestService;

  beforeEach(() => {
    nestRepository = createMockNestRepository();
    nestChat = createMockNestChatService();
    repositoryRepository = createMockRepositoryRepository();
    git = createMockGitService();
    folders = createMockFoldersService();
    service = new NestService(
      nestRepository,
      nestChat,
      repositoryRepository,
      git,
      folders,
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

  it("completes a nest by marking it dormant and compacting context", async () => {
    const listener = vi.fn();
    service.on(HedgemonyEvent.NestChanged, listener);
    const nest = await service.create({
      name: "Checkout",
      goalPrompt: "Improve checkout",
      mapX: 1,
      mapY: 1,
    });

    const completed = service.complete({
      id: nest.id,
      summary: "Merged checkout fixes and verified the happy path.",
      prUrls: ["https://github.com/posthog/posthog/pull/1"],
      taskIds: ["task-1"],
    });

    expect(completed.status).toBe("dormant");
    expect(nestChat.recordCompletionContext).toHaveBeenCalledWith(completed, {
      id: nest.id,
      summary: "Merged checkout fixes and verified the happy path.",
      prUrls: ["https://github.com/posthog/posthog/pull/1"],
      taskIds: ["task-1"],
    });
    expect(listener).toHaveBeenLastCalledWith({
      nestId: nest.id,
      event: { kind: "completed", nest: completed },
    });
  });

  it("forgets context only for dormant nests", async () => {
    const active = await service.create({
      name: "Active",
      goalPrompt: "Still working",
      mapX: 1,
      mapY: 1,
    });

    expect(() =>
      service.forgetCompletedContext({ id: active.id }),
    ).toThrowError("nest_must_be_dormant_to_forget_context");

    const dormant = service.complete({
      id: active.id,
      summary: "Done",
    });
    service.forgetCompletedContext({
      id: dormant.id,
      reason: "Clean up old context.",
    });

    expect(nestChat.forgetCompletedContext).toHaveBeenCalledWith(dormant, {
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
      service.complete({ id: "missing", summary: "Done" }),
    ).toThrowError("Nest not found: missing");
    expect(() =>
      service.forgetCompletedContext({ id: "missing" }),
    ).toThrowError("Nest not found: missing");
  });
});
