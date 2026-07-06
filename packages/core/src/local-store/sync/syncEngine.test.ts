import type { RootLogger, ScopedLogger } from "@posthog/di/logger";
import type {
  CrossWindowChannel,
  CrossWindowConnection,
} from "@posthog/platform/cross-window-channel";
import type { LeaderElection } from "@posthog/platform/leader-election";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EntityRegistry } from "../entityRegistry";
import { FakeLocalPersistence } from "../fakeLocalPersistence";
import { LocalStoreService } from "../localStoreService";
import { Outbox } from "../outbox/outbox";
import { type MutationExecutor, OutboxFlusher } from "../outbox/outboxFlusher";
import { Persister } from "../persister";
import { defineEntity, type SyncedEntity } from "../schemas";
import { ApplyPipeline } from "./applyPipeline";
import type { DeltaSource, PulledWindow } from "./deltaSource";
import { SyncEngine } from "./syncEngine";
import { SyncScheduler } from "./syncScheduler";

const noopScoped: ScopedLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
const fakeLogger: RootLogger = { ...noopScoped, scope: () => noopScoped };

const rowSchema = z.looseObject({
  id: z.string(),
  updated_at: z.string().nullish(),
}) as unknown as z.ZodType<SyncedEntity>;

const NS = { userId: "US", projectId: 7 };

/** In-memory stand-ins for navigator.locks + BroadcastChannel: a FIFO
 * election per lock name and a bus that never echoes to the sender. */
function makeWindowFakes() {
  const queues = new Map<
    string,
    Array<{ grant: (signal: AbortSignal) => void; abort: AbortController }>
  >();
  const held = new Map<string, AbortController>();

  const election: LeaderElection = {
    campaign(name, onLeadership) {
      const abort = new AbortController();
      const entry = { grant: onLeadership, abort };
      const queue = queues.get(name) ?? [];
      queue.push(entry);
      queues.set(name, queue);
      const tryGrant = () => {
        if (held.has(name)) return;
        const next = queues.get(name)?.[0];
        if (!next) return;
        const controller = new AbortController();
        held.set(name, controller);
        next.grant(controller.signal);
      };
      tryGrant();
      return () => {
        const q = queues.get(name) ?? [];
        const index = q.indexOf(entry);
        const wasHead = index === 0 && held.has(name);
        if (index >= 0) q.splice(index, 1);
        if (wasHead) {
          held.get(name)?.abort();
          held.delete(name);
          const next = q[0];
          if (next) {
            const controller = new AbortController();
            held.set(name, controller);
            next.grant(controller.signal);
          }
        }
      };
    },
  };

  const subscribers = new Map<string, Set<(data: unknown) => void>>();
  const channels: CrossWindowChannel = {
    open(name): CrossWindowConnection {
      const mine = new Set<(data: unknown) => void>();
      let all = subscribers.get(name);
      if (!all) {
        all = new Set();
        subscribers.set(name, all);
      }
      const bucket = all;
      return {
        postMessage(data) {
          for (const listener of bucket) {
            if (!mine.has(listener)) listener(data);
          }
        },
        subscribe(listener) {
          mine.add(listener);
          bucket.add(listener);
          return () => {
            mine.delete(listener);
            bucket.delete(listener);
          };
        },
        close() {
          for (const listener of mine) bucket.delete(listener);
          mine.clear();
        },
      };
    },
  };

  return { election, channels };
}

interface Rig {
  registry: EntityRegistry;
  engine: SyncEngine;
  outbox: Outbox;
  flusher: OutboxFlusher;
  persister: Persister;
  pool: ReturnType<EntityRegistry["register"]>;
}

function makeRig(
  persistence: FakeLocalPersistence,
  fakes: ReturnType<typeof makeWindowFakes>,
): Rig {
  const registry = new EntityRegistry();
  const pool = registry.register(
    defineEntity({
      name: "rows",
      version: 1,
      schema: rowSchema,
      hydration: "eager",
    }),
  );
  const persister = new Persister(registry, fakeLogger, 1);
  const store = new LocalStoreService(
    persistence,
    registry,
    persister,
    fakeLogger,
  );
  const pipeline = new ApplyPipeline(registry, fakeLogger);
  const outbox = new Outbox(store, registry, fakeLogger);
  const flusher = new OutboxFlusher(outbox, pipeline, fakeLogger);
  const scheduler = new SyncScheduler(pipeline, fakeLogger);
  const engine = new SyncEngine(
    store,
    scheduler,
    pipeline,
    outbox,
    flusher,
    fakes.election,
    fakes.channels,
    fakeLogger,
  );
  return { registry, engine, outbox, flusher, persister, pool };
}

function sourceOf(
  pull: () => Promise<PulledWindow<SyncedEntity>[] | null>,
  intervalMs = 60_000,
): DeltaSource<SyncedEntity> {
  return { collection: "rows", intervalMs, pull };
}

async function settle(ms = 30) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("SyncEngine integration", () => {
  it("cold boot renders from the cache with the network dead", async () => {
    const persistence = new FakeLocalPersistence();
    const fakes = makeWindowFakes();

    // Session 1: a healthy pull lands data and the persister flushes it.
    const first = makeRig(persistence, fakes);
    first.engine.registerSource(
      sourceOf(async () => [
        {
          key: "w",
          rows: [
            { id: "a", updated_at: "1" },
            { id: "b", updated_at: "1" },
          ],
          sweep: null,
        },
      ]),
    );
    await first.engine.start(NS);
    await settle();
    await first.persister.flush();
    await first.engine.stop();

    // Session 2 (fresh process): every pull fails — offline cold boot.
    const second = makeRig(persistence, fakes);
    second.engine.registerSource(
      sourceOf(async () => {
        throw new Error("network down");
      }),
    );
    await second.engine.start(NS);

    // Data is on screen from the local snapshot despite the dead network.
    expect(
      second.pool
        .getAll()
        .map((r) => r.id)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(second.pool.store.getState().hydrated).toBe(true);
    await second.engine.stop();
  });

  it("offline writes survive restart and flush on reconnect", async () => {
    const persistence = new FakeLocalPersistence();
    const fakes = makeWindowFakes();

    // Session 1: seed a row, then queue an edit while "offline" (skip).
    const first = makeRig(persistence, fakes);
    first.engine.registerSource(sourceOf(async () => []));
    const offlineExecutor: MutationExecutor = {
      collection: "rows",
      op: "update",
      execute: async () => "skip",
    };
    first.engine.registerExecutor(offlineExecutor);
    await first.engine.start(NS);
    first.pool.applyUpserts([{ id: "a", updated_at: "1" } as SyncedEntity]);
    await first.persister.flush();
    await first.outbox.enqueue({
      collection: "rows",
      recordId: "a",
      op: "update",
      payload: { name: "edited offline" },
      oldValues: { name: undefined },
    });
    await settle();
    await first.engine.stop();

    // Session 2: the queued write is visible immediately and flushes once
    // the network is back.
    const executed: string[] = [];
    const second = makeRig(persistence, fakes);
    second.engine.registerSource(sourceOf(async () => []));
    second.engine.registerExecutor({
      collection: "rows",
      op: "update",
      execute: async (entry) => {
        executed.push(entry.recordId);
        return {
          id: entry.recordId,
          name: "edited offline",
          updated_at: "2",
        } as SyncedEntity;
      },
    });
    await second.engine.start(NS);

    // Replayed optimistic state is on screen before any flush.
    expect((second.pool.get("a") as { name?: string } | undefined)?.name).toBe(
      "edited offline",
    );

    await second.flusher.pump();
    expect(executed).toEqual(["a"]);
    expect(second.outbox.list()).toHaveLength(0);
    await second.engine.stop();
  });

  it("follower applies broadcast deltas and takes over on leader death", async () => {
    const persistence = new FakeLocalPersistence();
    const fakes = makeWindowFakes();

    const pullsA: string[] = [];
    const pullsB: string[] = [];

    const windowA = makeRig(persistence, fakes);
    windowA.engine.registerSource(
      sourceOf(async () => {
        pullsA.push("tick");
        return [
          {
            key: "w",
            rows: [{ id: "from-leader", updated_at: "1" }],
            sweep: null,
          },
        ];
      }, 5),
    );
    const windowB = makeRig(persistence, fakes);
    windowB.engine.registerSource(
      sourceOf(async () => {
        pullsB.push("tick");
        return [
          { key: "w", rows: [{ id: "from-b", updated_at: "1" }], sweep: null },
        ];
      }, 5),
    );

    await windowA.engine.start(NS);
    await windowB.engine.start(NS);
    await settle(40);

    // A leads and pulls; B never pulls but sees A's delta via broadcast
    // (persist:false follower applies are covered by the pipeline suite).
    expect(pullsA.length).toBeGreaterThan(0);
    expect(pullsB.length).toBe(0);
    expect(windowB.pool.get("from-leader")).toBeDefined();

    // Leader window dies → B must win the election and start pulling.
    await windowA.engine.stop();
    await settle(40);

    expect(pullsB.length).toBeGreaterThan(0);
    expect(windowB.pool.get("from-b")).toBeDefined();
    await windowB.engine.stop();
  });
});
