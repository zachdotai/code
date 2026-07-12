import type { AnyTRPCRouter, inferRouterContext } from "@trpc/server";
import {
  callTRPCProcedure,
  getErrorShape,
  getTRPCErrorFromUnknown,
  isTrackedEnvelope,
  TRPCError,
  transformTRPCResponse,
} from "@trpc/server";
import {
  isObservable,
  observableToAsyncIterable,
} from "@trpc/server/observable";
import type { TRPCResponseMessage, TRPCResultMessage } from "@trpc/server/rpc";
import type { PortTrpcRequest } from "./messages";
import type { TransportPort } from "./transport-port";
import { isAsyncIterable, isObject, run } from "./utils";
import { Unpromise } from "./vendor/unpromise/unpromise";

type MaybePromise<TType> = Promise<TType> | TType;

export interface PortProcedureErrorPayload {
  error: TRPCError;
  path: string | undefined;
  type: "query" | "mutation" | "subscription";
  input: unknown;
}

/**
 * Called whenever procedure resolution fails. Errors are otherwise only
 * serialized back to the client, leaving no trace in the serving process.
 */
export type OnPortProcedureError = (payload: PortProcedureErrorPayload) => void;

export interface PortServerHandle {
  /** Detach from the port, abort all in-flight operations, close the port. */
  dispose(): void;
}

function isPortTrpcRequest(data: unknown): data is PortTrpcRequest {
  return (
    isObject(data) &&
    (data.method === "request" ||
      data.method === "subscription.stop" ||
      data.method === "operation.cancel")
  );
}

/**
 * Serve a tRPC router over one MessagePort. The request/response envelope and
 * subscription semantics (started/data/stopped, stop/cancel aborts) mirror
 * @posthog/electron-trpc's `handleIPCMessage`, with the Electron `event.reply`
 * seam replaced by the port and per-sender ids replaced by per-port ids (op
 * ids are already client-session scoped). One attachment per port; the peer
 * going away aborts every in-flight operation so subscription generators
 * always run their cleanup.
 */
export function attachPortServer<TRouter extends AnyTRPCRouter>({
  router,
  port,
  createContext,
  onError,
}: {
  router: TRouter;
  port: TransportPort;
  createContext?: () => MaybePromise<inferRouterContext<TRouter>>;
  onError?: OnPortProcedureError;
}): PortServerHandle {
  const operations = new Map<string | number, AbortController>();
  let closed = false;

  const respond = (response: TRPCResponseMessage) => {
    if (closed) return;
    port.postMessage(transformTRPCResponse(router._def._config, response));
  };

  async function handleRequest(message: PortTrpcRequest): Promise<void> {
    if (
      message.method === "subscription.stop" ||
      message.method === "operation.cancel"
    ) {
      operations.get(message.id)?.abort();
      return;
    }

    const { type, input: serializedInput, path, id } = message.operation;
    const input = serializedInput
      ? router._def._config.transformer.input.deserialize(serializedInput)
      : undefined;

    const abortController = new AbortController();

    if (operations.has(id)) {
      const error = getTRPCErrorFromUnknown(
        new TRPCError({
          message: `Duplicate id ${id}`,
          code: "BAD_REQUEST",
        }),
      );
      respond({
        id,
        error: getErrorShape({
          config: router._def._config,
          error,
          type,
          path,
          input,
          ctx: {},
        }),
      });
      return;
    }
    operations.set(id, abortController);

    const ctx = (await createContext?.()) ?? {};

    try {
      const result = await callTRPCProcedure({
        ctx,
        path,
        router,
        getRawInput: async () => input,
        type,
        signal: abortController.signal,
        // Port operations are never batched; the field is required as of
        // @trpc/server 11.17.
        batchIndex: 0,
      });

      const isIterableResult = isAsyncIterable(result) || isObservable(result);

      if (type !== "subscription") {
        if (isIterableResult) {
          throw new TRPCError({
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: `Cannot return an async iterable or observable from a ${type} procedure.`,
          });
        }

        respond({
          id,
          result: {
            type: "data",
            data: result,
          },
        });
        operations.delete(id);
        return;
      }

      if (!isIterableResult) {
        throw new TRPCError({
          message: `Subscription ${path} did not return an observable or a AsyncGenerator`,
          code: "INTERNAL_SERVER_ERROR",
        });
      }

      const iterable = isObservable(result)
        ? observableToAsyncIterable(result, abortController.signal)
        : result;

      run(async () => {
        const iterator = iterable[Symbol.asyncIterator]();

        const abortPromise = new Promise<"abort">((resolve) => {
          abortController.signal.onabort = () => resolve("abort");
        });
        // Declarations live outside the loop for garbage collection reasons —
        // declared inside, they would not be freed until the next value arrives.
        let next:
          | null
          | TRPCError
          | Awaited<
              typeof abortPromise | ReturnType<(typeof iterator)["next"]>
            >;
        let result: null | TRPCResultMessage<unknown>["result"];

        try {
          while (true) {
            next = await Unpromise.race([
              iterator.next().catch(getTRPCErrorFromUnknown),
              abortPromise,
            ]);

            if (next === "abort") {
              break;
            }
            if (next instanceof Error) {
              const error = getTRPCErrorFromUnknown(next);
              onError?.({ error, path, type, input });
              respond({
                id,
                error: getErrorShape({
                  config: router._def._config,
                  error,
                  type,
                  path,
                  input,
                  ctx,
                }),
              });
              break;
            }
            if (next.done) {
              break;
            }

            result = {
              type: "data",
              data: next.value,
            };

            if (isTrackedEnvelope(next.value)) {
              const [trackedId, data] = next.value;
              result.id = trackedId;
              result.data = {
                id: trackedId,
                data,
              };
            }

            respond({
              id,
              result,
            });

            // free up references for garbage collection
            next = null;
            result = null;
          }
        } finally {
          await iterator.return?.();
        }

        respond({
          id,
          result: {
            type: "stopped",
          },
        });
        operations.delete(id);
      }).catch((cause) => {
        const error = getTRPCErrorFromUnknown(cause);
        onError?.({ error, path, type, input });
        respond({
          id,
          error: getErrorShape({
            config: router._def._config,
            error,
            type,
            path,
            input,
            ctx,
          }),
        });
        abortController.abort();
        operations.delete(id);
      });

      respond({
        id,
        result: {
          type: "started",
        },
      });
    } catch (cause) {
      operations.delete(id);
      const error: TRPCError = getTRPCErrorFromUnknown(cause);
      onError?.({ error, path, type, input });

      respond({
        id,
        error: getErrorShape({
          config: router._def._config,
          error,
          type,
          path,
          input,
          ctx,
        }),
      });
    }
  }

  const abortAll = () => {
    for (const operation of operations.values()) {
      operation.abort();
    }
    operations.clear();
  };

  const offMessage = port.onMessage((data) => {
    if (!isPortTrpcRequest(data)) return;
    void handleRequest(data);
  });
  const offClose = port.onClose(() => {
    closed = true;
    abortAll();
  });
  port.start();

  return {
    dispose() {
      closed = true;
      offMessage();
      offClose();
      abortAll();
      port.close();
    },
  };
}
