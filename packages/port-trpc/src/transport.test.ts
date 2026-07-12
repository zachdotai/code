import type { MessagePort as NodeMessagePort } from "node:worker_threads";
import { createTRPCClient, type TRPCClientError } from "@trpc/client";
import { initTRPC } from "@trpc/server";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createPortBridge, portLink } from "./link";
import { attachPortServer, type PortServerHandle } from "./server";
import {
  type DomMessagePortLike,
  fromDomPort,
  type TransportPort,
} from "./transport-port";

// Node's worker_threads MessagePort delivers the payload directly on the
// EventEmitter "message" event (unlike DOM/MessagePortMain which wrap it in
// { data }), so tests get their own adapter. It doubles as coverage for a
// third TransportPort implementation.
function fromNodePort(port: NodeMessagePort): TransportPort {
  return {
    postMessage: (message) => port.postMessage(message),
    onMessage: (listener) => {
      const handler = (value: unknown) => listener(value);
      port.on("message", handler);
      return () => port.off("message", handler);
    },
    onClose: (listener) => {
      port.on("close", listener);
      return () => port.off("close", listener);
    },
    start: () => port.start(),
    close: () => port.close(),
  };
}

interface SubscriptionProbe {
  started: boolean;
  finished: boolean;
}

function buildRouter() {
  const t = initTRPC.create({ isServer: true });
  const probe: SubscriptionProbe = { started: false, finished: false };
  let infiniteResolvers: Array<(value: number) => void> = [];

  const router = t.router({
    echo: t.procedure
      .input(z.object({ value: z.string() }))
      .query(({ input }) => `echo:${input.value}`),
    add: t.procedure
      .input(z.object({ a: z.number(), b: z.number() }))
      .mutation(({ input }) => input.a + input.b),
    boom: t.procedure.query(() => {
      throw new Error("kaboom");
    }),
    countTo: t.procedure
      .input(z.object({ limit: z.number() }))
      .subscription(async function* ({ input }) {
        for (let i = 1; i <= input.limit; i++) {
          yield i;
        }
      }),
    // Signal-aware like the app's real subscription generators (they pump
    // TypedEventEmitter.toIterable(event, { signal })): the abort signal must
    // unblock the generator so iterator.return() can unwind it.
    infinite: t.procedure.subscription(async function* ({ signal }) {
      probe.started = true;
      try {
        while (true) {
          const value = await new Promise<number | "aborted">((resolve) => {
            if (signal?.aborted) {
              resolve("aborted");
              return;
            }
            infiniteResolvers.push(resolve as (value: number) => void);
            signal?.addEventListener("abort", () => resolve("aborted"), {
              once: true,
            });
          });
          if (value === "aborted") return;
          yield value;
        }
      } finally {
        probe.finished = true;
      }
    }),
  });

  return {
    router,
    probe,
    pushInfinite(value: number) {
      const resolvers = infiniteResolvers;
      infiniteResolvers = [];
      for (const resolve of resolvers) resolve(value);
    },
  };
}

type TestRouter = ReturnType<typeof buildRouter>["router"];

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("port-trpc transport", () => {
  const handles: PortServerHandle[] = [];
  afterEach(() => {
    for (const handle of handles.splice(0)) {
      handle.dispose();
    }
  });

  function serve(router: TestRouter, port: TransportPort) {
    const handle = attachPortServer({ router, port });
    handles.push(handle);
    return handle;
  }

  function clientOver(bridge: ReturnType<typeof createPortBridge>) {
    return createTRPCClient<TestRouter>({
      links: [portLink({ bridge })],
    });
  }

  it("round-trips queries and mutations", async () => {
    const { router } = buildRouter();
    const channel = new MessageChannel();
    serve(router, fromNodePort(channel.port1));

    const bridge = createPortBridge();
    bridge.connect(fromNodePort(channel.port2), 0);
    const client = clientOver(bridge);

    await expect(client.echo.query({ value: "hi" })).resolves.toBe("echo:hi");
    await expect(client.add.mutate({ a: 2, b: 40 })).resolves.toBe(42);
    channel.port2.close();
  });

  it("propagates procedure errors", async () => {
    const { router } = buildRouter();
    const channel = new MessageChannel();
    serve(router, fromNodePort(channel.port1));

    const bridge = createPortBridge();
    bridge.connect(fromNodePort(channel.port2), 0);
    const client = clientOver(bridge);

    await expect(client.boom.query()).rejects.toMatchObject({
      message: "kaboom",
    });
    channel.port2.close();
  });

  it("streams subscription values to completion", async () => {
    const { router } = buildRouter();
    const channel = new MessageChannel();
    serve(router, fromNodePort(channel.port1));

    const bridge = createPortBridge();
    bridge.connect(fromNodePort(channel.port2), 0);
    const client = clientOver(bridge);

    const values: number[] = [];
    let completed = false;
    client.countTo.subscribe(
      { limit: 3 },
      {
        onData: (value) => values.push(value),
        onComplete: () => {
          completed = true;
        },
      },
    );

    await waitFor(() => completed);
    expect(values).toEqual([1, 2, 3]);
    channel.port2.close();
  });

  it("runs subscription cleanup when the client unsubscribes", async () => {
    const { router, probe, pushInfinite } = buildRouter();
    const channel = new MessageChannel();
    serve(router, fromNodePort(channel.port1));

    const bridge = createPortBridge();
    bridge.connect(fromNodePort(channel.port2), 0);
    const client = clientOver(bridge);

    const values: number[] = [];
    const subscription = client.infinite.subscribe(undefined, {
      onData: (value) => values.push(value),
    });

    await waitFor(() => probe.started);
    pushInfinite(7);
    await waitFor(() => values.length === 1);

    subscription.unsubscribe();
    await waitFor(() => probe.finished);
    expect(values).toEqual([7]);
    channel.port2.close();
  });

  it("aborts server-side subscriptions when the peer port closes", async () => {
    const { router, probe } = buildRouter();
    const channel = new MessageChannel();
    serve(router, fromNodePort(channel.port1));

    const bridge = createPortBridge();
    bridge.connect(fromNodePort(channel.port2), 0);
    const client = clientOver(bridge);

    client.infinite.subscribe(undefined, {
      onData: () => {},
      onError: () => {},
    });
    await waitFor(() => probe.started);

    channel.port2.close();
    await waitFor(() => probe.finished);
  });

  it("queues operations issued before a port is connected", async () => {
    const { router } = buildRouter();
    const channel = new MessageChannel();
    serve(router, fromNodePort(channel.port1));

    const bridge = createPortBridge();
    const client = clientOver(bridge);

    const pending = client.echo.query({ value: "early" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    bridge.connect(fromNodePort(channel.port2), 0);

    await expect(pending).resolves.toBe("echo:early");
    channel.port2.close();
  });

  it("fails in-flight operations when the port is replaced, then serves on the new port", async () => {
    const { router, probe } = buildRouter();
    const first = new MessageChannel();
    serve(router, fromNodePort(first.port1));

    const bridge = createPortBridge();
    bridge.connect(fromNodePort(first.port2), 0);
    const client = clientOver(bridge);

    let subscriptionError: TRPCClientError<TestRouter> | null = null;
    client.infinite.subscribe(undefined, {
      onData: () => {},
      onError: (error) => {
        subscriptionError = error;
      },
    });
    await waitFor(() => probe.started);

    const second = new MessageChannel();
    serve(router, fromNodePort(second.port1));
    bridge.connect(fromNodePort(second.port2), 1);

    await waitFor(() => subscriptionError !== null);
    expect(String(subscriptionError)).toContain("reset");

    // New traffic flows over the replacement port.
    await expect(client.echo.query({ value: "again" })).resolves.toBe(
      "echo:again",
    );
    second.port2.close();
  });

  it("ignores ports from stale generations", async () => {
    const { router } = buildRouter();
    const current = new MessageChannel();
    serve(router, fromNodePort(current.port1));

    const bridge = createPortBridge();
    bridge.connect(fromNodePort(current.port2), 5);

    const stale = new MessageChannel();
    bridge.connect(fromNodePort(stale.port2), 3);
    expect(bridge.generation).toBe(5);

    const client = clientOver(bridge);
    await expect(client.echo.query({ value: "live" })).resolves.toBe(
      "echo:live",
    );
    current.port2.close();
  });

  it("supports two clients sharing one bridge without id collisions", async () => {
    const { router } = buildRouter();
    const channel = new MessageChannel();
    serve(router, fromNodePort(channel.port1));

    const bridge = createPortBridge();
    bridge.connect(fromNodePort(channel.port2), 0);
    const clientA = clientOver(bridge);
    const clientB = clientOver(bridge);

    const results = await Promise.all([
      clientA.echo.query({ value: "a" }),
      clientB.echo.query({ value: "b" }),
      clientA.add.mutate({ a: 1, b: 2 }),
      clientB.add.mutate({ a: 3, b: 4 }),
    ]);
    expect(results).toEqual(["echo:a", "echo:b", 3, 7]);
    channel.port2.close();
  });

  it("works over the DOM-shaped adapter (web-compat EventTarget surface)", async () => {
    const { router } = buildRouter();
    const channel = new MessageChannel();
    // Node's global MessagePort implements the web EventTarget surface at
    // runtime; this exercises the adapter the Electron renderer (and a future
    // Web Worker host) uses.
    serve(router, fromDomPort(channel.port1 as unknown as DomMessagePortLike));

    const bridge = createPortBridge();
    bridge.connect(
      fromDomPort(channel.port2 as unknown as DomMessagePortLike),
      0,
    );
    const client = clientOver(bridge);

    await expect(client.echo.query({ value: "dom" })).resolves.toBe("echo:dom");
    channel.port2.close();
  });
});
