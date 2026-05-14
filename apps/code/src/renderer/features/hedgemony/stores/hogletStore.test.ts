import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {
    hedgemony: {
      hoglets: {
        list: { query: vi.fn() },
        watch: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
      },
    },
  },
}));

vi.mock("@features/auth/hooks/authClient", () => ({
  getAuthenticatedClient: vi.fn(),
}));

vi.mock("@utils/logger", () => ({
  logger: {
    scope: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

import type { Hoglet } from "@main/services/hedgemony/schemas";
import {
  selectWildHoglets,
  selectWildLoaded,
  useHogletStore,
  WILD_BUCKET,
} from "./hogletStore";

function makeHoglet(overrides: Partial<Hoglet> = {}): Hoglet {
  const now = "2026-05-13T00:00:00.000Z";
  return {
    id: crypto.randomUUID(),
    name: null,
    taskId: `task-${crypto.randomUUID().slice(0, 8)}`,
    nestId: null,
    signalReportId: null,
    affinityScore: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

describe("hogletStore", () => {
  beforeEach(() => {
    useHogletStore.getState().reset();
  });

  it("seeds a bucket and exposes it via selectors", () => {
    const a = makeHoglet({ taskId: "task-a" });
    const b = makeHoglet({ taskId: "task-b" });

    useHogletStore.getState().setBucket(WILD_BUCKET, [a, b]);

    expect(selectWildLoaded(useHogletStore.getState())).toBe(true);
    expect(selectWildHoglets(useHogletStore.getState())).toEqual([a, b]);
  });

  it("upserts replace existing entries by id", () => {
    const original = makeHoglet({ id: "hog-1", taskId: "task-a" });
    useHogletStore.getState().setBucket(WILD_BUCKET, [original]);

    const updated = { ...original, taskId: "task-a-renamed" };
    useHogletStore.getState().upsert(WILD_BUCKET, updated);

    expect(selectWildHoglets(useHogletStore.getState())).toEqual([updated]);
  });

  it("remove drops a hoglet from the bucket", () => {
    const a = makeHoglet({ id: "hog-1", taskId: "task-a" });
    const b = makeHoglet({ id: "hog-2", taskId: "task-b" });
    useHogletStore.getState().setBucket(WILD_BUCKET, [a, b]);

    useHogletStore.getState().remove(WILD_BUCKET, a.id);

    expect(selectWildHoglets(useHogletStore.getState())).toEqual([b]);
  });

  it("setTaskSummaries merges by id", () => {
    useHogletStore.getState().setTaskSummaries([
      {
        id: "task-a",
        title: "First",
        repository: null,
        created_at: "",
        updated_at: "",
        latest_run: null,
      },
    ]);

    expect(useHogletStore.getState().taskSummaries["task-a"]).toMatchObject({
      title: "First",
    });

    useHogletStore.getState().setTaskSummaries([
      {
        id: "task-a",
        title: "First (updated)",
        repository: null,
        created_at: "",
        updated_at: "",
        latest_run: null,
      },
      {
        id: "task-b",
        title: "Second",
        repository: null,
        created_at: "",
        updated_at: "",
        latest_run: null,
      },
    ]);

    expect(useHogletStore.getState().taskSummaries["task-a"].title).toBe(
      "First (updated)",
    );
    expect(useHogletStore.getState().taskSummaries["task-b"].title).toBe(
      "Second",
    );
  });

  it("returns an empty list when wild bucket is empty", () => {
    expect(selectWildHoglets(useHogletStore.getState())).toEqual([]);
    expect(selectWildLoaded(useHogletStore.getState())).toBe(false);
  });
});
