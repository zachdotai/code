import type { Hoglet } from "@main/services/hedgemony/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTrack = vi.hoisted(() => vi.fn());
vi.mock("@utils/analytics", () => ({ track: mockTrack }));
vi.mock("@renderer/trpc/client", () => ({ trpcClient: {} }));

import { WILD_BUCKET } from "../constants/buckets";
import type { HogletPositionRepository } from "../domain/HogletPositionRepository";
import type { HogletRemoteService } from "../domain/HogletRemoteService";
import type { HogletRepository } from "../domain/HogletRepository";
import type { ToastSink } from "../domain/ToastSink";
import {
  adoptHoglet,
  handleHogletDrop,
  releaseHoglet,
} from "./hogletMutations";

function makeHoglet(overrides: Partial<Hoglet> = {}): Hoglet {
  return {
    id: "hog-1",
    name: "Hogwart",
    taskId: "task-1",
    nestId: null,
    signalReportId: null,
    affinityScore: null,
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

interface FakeHogletRepo extends HogletRepository {
  buckets: Map<string, Hoglet[]>;
}

function makeHogletRepo(
  initial: Record<string, Hoglet[]> = {},
): FakeHogletRepo {
  const buckets = new Map<string, Hoglet[]>(Object.entries(initial));
  return {
    buckets,
    findInBucket(bucket, hogletId) {
      return buckets.get(bucket)?.find((h) => h.id === hogletId) ?? null;
    },
    upsert(bucket, hoglet) {
      const existing = buckets.get(bucket) ?? [];
      const without = existing.filter((h) => h.id !== hoglet.id);
      buckets.set(bucket, [...without, hoglet]);
    },
    remove(bucket, hogletId) {
      const existing = buckets.get(bucket);
      if (!existing) return;
      buckets.set(
        bucket,
        existing.filter((h) => h.id !== hogletId),
      );
    },
    setBucket(bucket, hoglets) {
      buckets.set(bucket, hoglets);
    },
    startDying() {},
    setTaskSummaries() {},
    collectTaskIds() {
      const ids = new Set<string>();
      for (const list of buckets.values()) {
        for (const h of list) ids.add(h.taskId);
      }
      return [...ids];
    },
  };
}

function makePositionRepo(): HogletPositionRepository & { cleared: string[] } {
  const cleared: string[] = [];
  return {
    cleared,
    clearPosition(hogletId) {
      cleared.push(hogletId);
    },
    getPosition() {
      return null;
    },
  };
}

function makeToastSink(): ToastSink & { errorCalls: string[] } {
  const errorCalls: string[] = [];
  return {
    errorCalls,
    info() {},
    error(message) {
      errorCalls.push(message);
    },
  };
}

describe("adoptHoglet", () => {
  beforeEach(() => {
    mockTrack.mockReset();
  });

  it("optimistically moves the hoglet from wild into the target nest and confirms with the RPC payload", async () => {
    const wildHoglet = makeHoglet({ nestId: null });
    const serverEcho = makeHoglet({
      nestId: "nest-1",
      updatedAt: "2026-05-13T00:01:00.000Z",
    });
    const hoglets = makeHogletRepo({ [WILD_BUCKET]: [wildHoglet] });
    const positions = makePositionRepo();
    const remote: HogletRemoteService = {
      adopt: vi.fn().mockResolvedValue(serverEcho),
      release: vi.fn(),
      list: vi.fn(),
      watch: vi.fn(),
    };
    const toast = makeToastSink();

    await adoptHoglet("hog-1", "nest-1", "wild", {
      hoglets,
      positions,
      remote,
      toast,
    });

    expect(hoglets.buckets.get(WILD_BUCKET)).toEqual([]);
    expect(hoglets.buckets.get("nest-1")).toEqual([serverEcho]);
    expect(remote.adopt).toHaveBeenCalledWith({
      hogletId: "hog-1",
      nestId: "nest-1",
    });
    expect(positions.cleared).toEqual(["hog-1"]);
    expect(mockTrack).toHaveBeenCalledWith(
      "hedgemony.hoglet_adopted",
      expect.objectContaining({ source: "wild" }),
    );
    expect(toast.errorCalls).toEqual([]);
  });

  it("is a no-op when the hoglet is missing from the wild bucket", async () => {
    const hoglets = makeHogletRepo({ [WILD_BUCKET]: [] });
    const positions = makePositionRepo();
    const remote: HogletRemoteService = {
      adopt: vi.fn(),
      release: vi.fn(),
      list: vi.fn(),
      watch: vi.fn(),
    };
    const toast = makeToastSink();

    await adoptHoglet("missing", "nest-1", "wild", {
      hoglets,
      positions,
      remote,
      toast,
    });

    expect(remote.adopt).not.toHaveBeenCalled();
    expect(positions.cleared).toEqual([]);
  });

  it("rolls the hoglet back to the wild bucket when the RPC fails", async () => {
    const wildHoglet = makeHoglet({ nestId: null });
    const hoglets = makeHogletRepo({ [WILD_BUCKET]: [wildHoglet] });
    const positions = makePositionRepo();
    const remote: HogletRemoteService = {
      adopt: vi.fn().mockRejectedValue(new Error("network")),
      release: vi.fn(),
      list: vi.fn(),
      watch: vi.fn(),
    };
    const toast = makeToastSink();

    await adoptHoglet("hog-1", "nest-1", "signal", {
      hoglets,
      positions,
      remote,
      toast,
    });

    expect(hoglets.buckets.get("nest-1")).toEqual([]);
    expect(hoglets.buckets.get(WILD_BUCKET)).toEqual([wildHoglet]);
    expect(toast.errorCalls).toEqual(["Could not adopt hoglet"]);
    expect(mockTrack).not.toHaveBeenCalled();
  });
});

describe("releaseHoglet", () => {
  beforeEach(() => {
    mockTrack.mockReset();
  });

  it("optimistically moves the hoglet back to wild and confirms with the RPC payload", async () => {
    const nestHoglet = makeHoglet({ nestId: "nest-1" });
    const serverEcho = makeHoglet({
      nestId: null,
      updatedAt: "2026-05-13T00:01:00.000Z",
    });
    const hoglets = makeHogletRepo({ "nest-1": [nestHoglet] });
    const positions = makePositionRepo();
    const remote: HogletRemoteService = {
      adopt: vi.fn(),
      release: vi.fn().mockResolvedValue(serverEcho),
      list: vi.fn(),
      watch: vi.fn(),
    };
    const toast = makeToastSink();

    await releaseHoglet("hog-1", "nest-1", {
      hoglets,
      positions,
      remote,
      toast,
    });

    expect(hoglets.buckets.get("nest-1")).toEqual([]);
    expect(hoglets.buckets.get(WILD_BUCKET)).toEqual([serverEcho]);
    expect(remote.release).toHaveBeenCalledWith({ hogletId: "hog-1" });
    expect(positions.cleared).toEqual(["hog-1"]);
    expect(mockTrack).toHaveBeenCalledWith(
      "hedgemony.hoglet_released",
      expect.objectContaining({ source: "nest" }),
    );
    expect(toast.errorCalls).toEqual([]);
  });

  it("is a no-op when the hoglet is missing from the source nest bucket", async () => {
    const hoglets = makeHogletRepo({ "nest-1": [] });
    const positions = makePositionRepo();
    const remote: HogletRemoteService = {
      adopt: vi.fn(),
      release: vi.fn(),
      list: vi.fn(),
      watch: vi.fn(),
    };
    const toast = makeToastSink();

    await releaseHoglet("missing", "nest-1", {
      hoglets,
      positions,
      remote,
      toast,
    });

    expect(remote.release).not.toHaveBeenCalled();
    expect(positions.cleared).toEqual([]);
  });

  it("rolls the hoglet back to the source nest when the RPC fails", async () => {
    const nestHoglet = makeHoglet({ nestId: "nest-1" });
    const hoglets = makeHogletRepo({ "nest-1": [nestHoglet] });
    const positions = makePositionRepo();
    const remote: HogletRemoteService = {
      adopt: vi.fn(),
      release: vi.fn().mockRejectedValue(new Error("network")),
      list: vi.fn(),
      watch: vi.fn(),
    };
    const toast = makeToastSink();

    await releaseHoglet("hog-1", "nest-1", {
      hoglets,
      positions,
      remote,
      toast,
    });

    expect(hoglets.buckets.get(WILD_BUCKET)).toEqual([]);
    expect(hoglets.buckets.get("nest-1")).toEqual([nestHoglet]);
    expect(toast.errorCalls).toEqual(["Could not release hoglet"]);
    expect(mockTrack).not.toHaveBeenCalled();
  });
});

describe("handleHogletDrop", () => {
  beforeEach(() => {
    mockTrack.mockReset();
  });

  it("ignores drops where the source is not a hoglet", () => {
    const hoglets = makeHogletRepo();
    const positions = makePositionRepo();
    const remote: HogletRemoteService = {
      adopt: vi.fn(),
      release: vi.fn(),
      list: vi.fn(),
      watch: vi.fn(),
    };
    const toast = makeToastSink();

    handleHogletDrop(
      { type: "something-else" },
      { type: "nest", nestId: "nest-1" },
      { hoglets, positions, remote, toast },
    );

    expect(remote.adopt).not.toHaveBeenCalled();
    expect(remote.release).not.toHaveBeenCalled();
  });

  it("adopts a wild hoglet onto a nest", async () => {
    const wildHoglet = makeHoglet({ nestId: null });
    const serverEcho = makeHoglet({ nestId: "nest-1" });
    const hoglets = makeHogletRepo({ [WILD_BUCKET]: [wildHoglet] });
    const positions = makePositionRepo();
    const remote: HogletRemoteService = {
      adopt: vi.fn().mockResolvedValue(serverEcho),
      release: vi.fn(),
      list: vi.fn(),
      watch: vi.fn(),
    };
    const toast = makeToastSink();

    handleHogletDrop(
      { type: "hoglet", hogletId: "hog-1", sourceNestId: null },
      { type: "nest", nestId: "nest-1" },
      { hoglets, positions, remote, toast },
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(remote.adopt).toHaveBeenCalledWith({
      hogletId: "hog-1",
      nestId: "nest-1",
    });
  });

  it("classifies signal-backed wild hoglets so adopt tracks source=signal", async () => {
    const wildHoglet = makeHoglet({
      nestId: null,
      signalReportId: "signal-9",
    });
    const serverEcho = makeHoglet({ nestId: "nest-1" });
    const hoglets = makeHogletRepo({ [WILD_BUCKET]: [wildHoglet] });
    const positions = makePositionRepo();
    const remote: HogletRemoteService = {
      adopt: vi.fn().mockResolvedValue(serverEcho),
      release: vi.fn(),
      list: vi.fn(),
      watch: vi.fn(),
    };
    const toast = makeToastSink();

    handleHogletDrop(
      { type: "hoglet", hogletId: "hog-1", sourceNestId: null },
      { type: "nest", nestId: "nest-1" },
      { hoglets, positions, remote, toast },
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(mockTrack).toHaveBeenCalledWith(
      "hedgemony.hoglet_adopted",
      expect.objectContaining({ source: "signal" }),
    );
  });

  it("rejects nest→nest direct transfer with an error toast", () => {
    const hoglets = makeHogletRepo();
    const positions = makePositionRepo();
    const remote: HogletRemoteService = {
      adopt: vi.fn(),
      release: vi.fn(),
      list: vi.fn(),
      watch: vi.fn(),
    };
    const toast = makeToastSink();

    handleHogletDrop(
      { type: "hoglet", hogletId: "hog-1", sourceNestId: "nest-1" },
      { type: "nest", nestId: "nest-2" },
      { hoglets, positions, remote, toast },
    );

    expect(remote.adopt).not.toHaveBeenCalled();
    expect(toast.errorCalls).toEqual([
      "Release this hoglet to wild before adopting it elsewhere",
    ]);
  });

  it("releases a nest-held hoglet when dropped on wild", async () => {
    const nestHoglet = makeHoglet({ nestId: "nest-1" });
    const serverEcho = makeHoglet({ nestId: null });
    const hoglets = makeHogletRepo({ "nest-1": [nestHoglet] });
    const positions = makePositionRepo();
    const remote: HogletRemoteService = {
      adopt: vi.fn(),
      release: vi.fn().mockResolvedValue(serverEcho),
      list: vi.fn(),
      watch: vi.fn(),
    };
    const toast = makeToastSink();

    handleHogletDrop(
      { type: "hoglet", hogletId: "hog-1", sourceNestId: "nest-1" },
      { type: "wild" },
      { hoglets, positions, remote, toast },
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(remote.release).toHaveBeenCalledWith({ hogletId: "hog-1" });
  });

  it("is a no-op when a wild hoglet is dropped back onto wild", () => {
    const hoglets = makeHogletRepo();
    const positions = makePositionRepo();
    const remote: HogletRemoteService = {
      adopt: vi.fn(),
      release: vi.fn(),
      list: vi.fn(),
      watch: vi.fn(),
    };
    const toast = makeToastSink();

    handleHogletDrop(
      { type: "hoglet", hogletId: "hog-1", sourceNestId: null },
      { type: "wild" },
      { hoglets, positions, remote, toast },
    );

    expect(remote.release).not.toHaveBeenCalled();
    expect(remote.adopt).not.toHaveBeenCalled();
  });
});
