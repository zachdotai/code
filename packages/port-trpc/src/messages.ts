import type { Operation } from "@trpc/client";
import type { TRPCResponseMessage } from "@trpc/server/rpc";

/**
 * Wire envelope for tRPC operations over a MessagePort. Identical to the
 * `ETRPCRequest` shape used by @posthog/electron-trpc's single-channel IPC
 * transport, so the two transports stay protocol-compatible and a router can
 * move between them without renegotiating anything. Payloads travel by
 * structured clone; the routers this carries use the identity transformer.
 */
export type PortTrpcRequest =
  | { method: "request"; operation: Operation }
  | { method: "subscription.stop"; id: string | number }
  | { method: "operation.cancel"; id: string | number };

export type PortTrpcResponse = TRPCResponseMessage;
