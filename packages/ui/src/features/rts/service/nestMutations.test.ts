import type { Nest } from "@posthog/host-router/rts-schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPlaySfx = vi.hoisted(() => vi.fn());
vi.mock("../audio/sfx", () => ({ playSfx: mockPlaySfx }));

import type { NestRemoteService } from "../domain/NestRemoteService";
import type { NestRepository } from "../domain/NestRepository";
import type { ToastSink } from "../domain/ToastSink";
import { moveNest } from "./nestMutations";

function makeNest(overrides: Partial<Nest> = {}): Nest {
  return {
    id: "nest-1",
    name: "First Nest",
    goalPrompt: "ship",
    definitionOfDone: null,
    mapX: 100,
    mapY: 200,
    status: "active",
    health: "ok",
    targetMetricId: null,
    loadoutJson: null,
    primaryRepository: null,
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...overrides,
  };
}

function makeNestRepo(): NestRepository & {
  current: Nest | null;
  upsertCalls: Nest[];
} {
  const calls: Nest[] = [];
  let current: Nest | null = null;
  return {
    upsertCalls: calls,
    get current() {
      return current;
    },
    upsert(nest) {
      calls.push(nest);
      current = nest;
    },
    remove() {},
    setAll() {},
    setHedgehogState() {},
    subscribeToKeys() {
      return () => {};
    },
  };
}

function makeToastSink(): ToastSink & {
  infoCalls: Array<{ message: string; action?: { label: string } }>;
  errorCalls: string[];
} {
  return {
    infoCalls: [],
    errorCalls: [],
    info(message, options) {
      this.infoCalls.push({
        message,
        action: options?.action ? { label: options.action.label } : undefined,
      });
    },
    error(message) {
      this.errorCalls.push(message);
    },
  };
}

describe("moveNest", () => {
  beforeEach(() => {
    mockPlaySfx.mockReset();
  });

  it("optimistically upserts the new position then confirms with the RPC payload", async () => {
    const original = makeNest({ mapX: 100, mapY: 200 });
    const serverEcho = makeNest({
      mapX: 300,
      mapY: 400,
      updatedAt: "2026-05-13T00:01:00.000Z",
    });
    const nests = makeNestRepo();
    const remote: NestRemoteService = {
      update: vi.fn().mockResolvedValue(serverEcho),
      list: vi.fn(),
      watch: vi.fn(),
    };
    const toast = makeToastSink();

    await moveNest(original, 300, 400, {}, { nests, remote, toast });

    expect(nests.upsertCalls).toHaveLength(2);
    expect(nests.upsertCalls[0]).toMatchObject({ mapX: 300, mapY: 400 });
    expect(nests.upsertCalls[1]).toBe(serverEcho);
    expect(remote.update).toHaveBeenCalledWith({
      id: "nest-1",
      mapX: 300,
      mapY: 400,
    });
    expect(toast.errorCalls).toEqual([]);
  });

  it("surfaces an undo toast only when undoable is true", async () => {
    const original = makeNest();
    const serverEcho = makeNest({ mapX: 300, mapY: 400 });
    const nests = makeNestRepo();
    const remote: NestRemoteService = {
      update: vi.fn().mockResolvedValue(serverEcho),
      list: vi.fn(),
      watch: vi.fn(),
    };
    const toast = makeToastSink();

    await moveNest(
      original,
      300,
      400,
      { undoable: true },
      { nests, remote, toast },
    );

    expect(toast.infoCalls).toHaveLength(1);
    expect(toast.infoCalls[0].message).toBe("Nest moved");
    expect(toast.infoCalls[0].action?.label).toBe("Undo");
  });

  it("does not show an undo toast when undoable is false", async () => {
    const original = makeNest();
    const serverEcho = makeNest({ mapX: 300, mapY: 400 });
    const nests = makeNestRepo();
    const remote: NestRemoteService = {
      update: vi.fn().mockResolvedValue(serverEcho),
      list: vi.fn(),
      watch: vi.fn(),
    };
    const toast = makeToastSink();

    await moveNest(original, 300, 400, {}, { nests, remote, toast });

    expect(toast.infoCalls).toEqual([]);
  });

  it("rolls the local store back to the previous nest when the RPC fails", async () => {
    const original = makeNest({ mapX: 100, mapY: 200 });
    const nests = makeNestRepo();
    const remote: NestRemoteService = {
      update: vi.fn().mockRejectedValue(new Error("network")),
      list: vi.fn(),
      watch: vi.fn(),
    };
    const toast = makeToastSink();

    await moveNest(original, 300, 400, {}, { nests, remote, toast });

    expect(nests.upsertCalls).toHaveLength(2);
    expect(nests.upsertCalls[0]).toMatchObject({ mapX: 300, mapY: 400 });
    expect(nests.upsertCalls[1]).toBe(original);
    expect(nests.current).toBe(original);
    expect(toast.errorCalls).toEqual(["Could not move nest"]);
    expect(mockPlaySfx).toHaveBeenCalledWith("error");
  });
});
