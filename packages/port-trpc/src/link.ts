import { type Operation, TRPCClientError, type TRPCLink } from "@trpc/client";
import {
  getTransformer,
  type TransformerOptions,
} from "@trpc/client/unstable-internals";
import type {
  AnyTRPCRouter,
  inferRouterContext,
  inferTRPCClientTypes,
  TRPCProcedureType,
} from "@trpc/server";
import { type Observer, observable } from "@trpc/server/observable";
import type { TRPCResponseMessage } from "@trpc/server/rpc";
import type { PortTrpcRequest } from "./messages";
import type { TransportPort } from "./transport-port";
import { transformResult } from "./utils";

type ScopedOperation = Omit<Operation, "id"> & { id: string };

type PortCallbackResult<TRouter extends AnyTRPCRouter = AnyTRPCRouter> =
  TRPCResponseMessage<unknown, inferRouterContext<TRouter>>;

type PortCallbacks<TRouter extends AnyTRPCRouter = AnyTRPCRouter> = Observer<
  PortCallbackResult<TRouter>,
  TRPCClientError<TRouter>
>;

type PortRequest = {
  type: TRPCProcedureType;
  callbacks: PortCallbacks;
  op: ScopedOperation;
};

/**
 * Holds the link's connection to the serving process. The port can arrive
 * after the first operations are issued (they queue) and can be replaced when
 * the serving process restarts: a replacement (or the port closing) resets the
 * bridge, which fails every in-flight operation so callers' existing
 * error/reconnect paths run, then routes new traffic to the fresh port.
 * Generations guard against a stale port from an older spawn arriving after a
 * newer one.
 */
export class PortBridge {
  #port: TransportPort | null = null;
  #generation = Number.NEGATIVE_INFINITY;
  #outbox: PortTrpcRequest[] = [];
  #messageListeners = new Set<(response: TRPCResponseMessage) => void>();
  #resetListeners = new Set<() => void>();
  #detachers: Array<() => void> = [];

  get generation(): number {
    return this.#generation;
  }

  get isConnected(): boolean {
    return this.#port !== null;
  }

  connect(port: TransportPort, generation?: number): void {
    const nextGeneration =
      generation ??
      (Number.isFinite(this.#generation) ? this.#generation + 1 : 0);
    if (nextGeneration <= this.#generation) {
      // A port from an older spawn arriving late — never adopt it.
      port.close();
      return;
    }
    this.#generation = nextGeneration;

    for (const detach of this.#detachers) detach();
    this.#detachers = [];
    const previous = this.#port;
    this.#port = port;
    previous?.close();

    this.#detachers.push(
      port.onMessage((data) => {
        for (const listener of this.#messageListeners) {
          listener(data as TRPCResponseMessage);
        }
      }),
    );
    this.#detachers.push(
      port.onClose(() => {
        if (this.#port !== port) return;
        // Peer went away with no replacement yet: fail in-flight work now and
        // queue anything new until a fresh port arrives.
        this.#port = null;
        this.#notifyReset();
      }),
    );
    port.start();

    if (previous) {
      // Everything in flight belonged to the old port's peer.
      this.#notifyReset();
    }

    const queued = this.#outbox;
    this.#outbox = [];
    for (const message of queued) {
      port.postMessage(message);
    }
  }

  sendMessage(message: PortTrpcRequest): void {
    if (this.#port) {
      this.#port.postMessage(message);
    } else {
      this.#outbox.push(message);
    }
  }

  onMessage(listener: (response: TRPCResponseMessage) => void): () => void {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  /** Fired when in-flight operations can no longer complete (port replaced or closed). */
  onReset(listener: () => void): () => void {
    this.#resetListeners.add(listener);
    return () => this.#resetListeners.delete(listener);
  }

  #notifyReset(): void {
    for (const listener of this.#resetListeners) {
      listener();
    }
  }
}

export function createPortBridge(): PortBridge {
  return new PortBridge();
}

class PortClient {
  #pendingRequests = new Map<string | number, PortRequest>();
  #bridge: PortBridge;
  #sessionId = crypto.randomUUID();

  constructor(bridge: PortBridge) {
    this.#bridge = bridge;
    bridge.onMessage((response) => {
      this.#handleResponse(response);
    });
    bridge.onReset(() => {
      this.#failAllPending();
    });
  }

  #handleResponse(response: TRPCResponseMessage) {
    const request = response.id && this.#pendingRequests.get(response.id);
    if (!request) {
      return;
    }

    request.callbacks.next(response);

    if ("result" in response && response.result.type === "stopped") {
      request.callbacks.complete();
    }
  }

  #failAllPending() {
    const pending = [...this.#pendingRequests.values()];
    this.#pendingRequests.clear();
    for (const request of pending) {
      request.callbacks.error(
        TRPCClientError.from(
          new Error("Connection to the serving process was reset."),
        ),
      );
    }
  }

  request(op: Operation, callbacks: PortCallbacks) {
    const { type, signal } = op;
    const scopedId = `${this.#sessionId}:${op.id}`;
    const scopedOp = { ...op, id: scopedId };

    if (signal?.aborted) {
      callbacks.error(
        TRPCClientError.from(new Error("The operation was aborted.")),
      );
      return () => {};
    }

    this.#pendingRequests.set(scopedId, {
      type,
      callbacks,
      op: scopedOp,
    });

    this.#bridge.sendMessage({
      method: "request",
      operation: scopedOp as unknown as Operation,
    });

    const onAbort = () => {
      if (!this.#pendingRequests.has(scopedId)) return;
      this.#bridge.sendMessage({
        id: scopedId,
        method: "operation.cancel",
      });
    };
    signal?.addEventListener("abort", onAbort);

    return () => {
      const callbacks = this.#pendingRequests.get(scopedId)?.callbacks;

      this.#pendingRequests.delete(scopedId);
      signal?.removeEventListener("abort", onAbort);

      callbacks?.complete();

      if (type === "subscription") {
        this.#bridge.sendMessage({
          id: scopedId,
          method: "subscription.stop",
        });
      }
    };
  }
}

export type PortLinkOptions<TRouter extends AnyTRPCRouter> = {
  bridge: PortBridge;
} & TransformerOptions<inferTRPCClientTypes<TRouter>>;

export function portLink<TRouter extends AnyTRPCRouter>(
  opts: PortLinkOptions<TRouter>,
): TRPCLink<TRouter> {
  return () => {
    const client = new PortClient(opts.bridge);
    const transformer = getTransformer(opts.transformer);

    return ({ op }) => {
      return observable((observer) => {
        op.input = transformer.input.serialize(op.input);

        const unsubscribe = client.request(op, {
          error(err) {
            observer.error(err as TRPCClientError<TRouter>);
            unsubscribe();
          },
          complete() {
            observer.complete();
          },
          next(response) {
            const transformed = transformResult(response, transformer.output);

            if (!transformed.ok) {
              observer.error(TRPCClientError.from(transformed.error));
              return;
            }

            observer.next({ result: transformed.result });

            if (op.type !== "subscription") {
              unsubscribe();
              observer.complete();
            }
          },
        });

        return () => {
          unsubscribe();
        };
      });
    };
  };
}
