import type {
  AnyTRPCRouter,
  inferRouterError,
  TRPCCombinedDataTransformer,
} from "@trpc/server";
import type {
  TRPCResponse,
  TRPCResponseMessage,
  TRPCResultMessage,
} from "@trpc/server/rpc";

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && !Array.isArray(value) && typeof value === "object";
}

const asyncIteratorsSupported =
  typeof Symbol === "function" && !!Symbol.asyncIterator;

export function isAsyncIterable<TValue>(
  value: unknown,
): value is AsyncIterable<TValue> {
  return (
    asyncIteratorsSupported && isObject(value) && Symbol.asyncIterator in value
  );
}

/** Run an IIFE */
export const run = <TValue>(fn: () => TValue): TValue => fn();

// from @trpc/client/src/links/internals/transformResult (same vendoring as
// @posthog/electron-trpc's renderer link)
/** @internal */
export function transformResult<TRouter extends AnyTRPCRouter, TOutput>(
  response:
    | TRPCResponseMessage<TOutput, inferRouterError<TRouter>>
    | TRPCResponse<TOutput, inferRouterError<TRouter>>,
  transformer: TRPCCombinedDataTransformer["output"],
) {
  if ("error" in response) {
    const error = transformer.deserialize(
      response.error,
    ) as inferRouterError<TRouter>;
    return {
      ok: false,
      error: {
        ...response,
        error,
      },
    } as const;
  }

  const result = {
    ...response.result,
    ...((!response.result.type || response.result.type === "data") && {
      type: "data",
      data: transformer.deserialize(response.result.data) as unknown,
    }),
  } as TRPCResultMessage<TOutput>["result"];
  return { ok: true, result } as const;
}
