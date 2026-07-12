/**
 * Handshake protocol between the Electron main process and the node-host
 * utilityProcess, spoken over `UtilityProcess.postMessage` / `process.parentPort`.
 * tRPC traffic does NOT flow here — it runs over the MessagePorts these
 * messages carry (control + host-capabilities pairs at init, one port per
 * renderer window on demand).
 */

export interface NodeHostInitMessage {
  type: "node-host:init";
  /** Monotonic spawn counter; stale ports from older spawns are discarded. */
  generation: number;
}

export interface NodeHostRendererPortMessage {
  type: "node-host:renderer-port";
  generation: number;
  /** The window this port serves; a replacement closes its predecessor. */
  webContentsId: number;
}

export interface NodeHostPingMessage {
  type: "node-host:ping";
}

export interface NodeHostShutdownMessage {
  type: "node-host:shutdown";
}

export type NodeHostToChildMessage =
  | NodeHostInitMessage
  | NodeHostRendererPortMessage
  | NodeHostPingMessage
  | NodeHostShutdownMessage;

export interface NodeHostReadyMessage {
  type: "node-host:ready";
}

export interface NodeHostPongMessage {
  type: "node-host:pong";
}

export type NodeHostFromChildMessage =
  | NodeHostReadyMessage
  | NodeHostPongMessage;

function isTyped(value: unknown): value is { type: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

export function isNodeHostToChildMessage(
  value: unknown,
): value is NodeHostToChildMessage {
  return (
    isTyped(value) &&
    (value.type === "node-host:init" ||
      value.type === "node-host:renderer-port" ||
      value.type === "node-host:ping" ||
      value.type === "node-host:shutdown")
  );
}

export function isNodeHostFromChildMessage(
  value: unknown,
): value is NodeHostFromChildMessage {
  return (
    isTyped(value) &&
    (value.type === "node-host:ready" || value.type === "node-host:pong")
  );
}

/** Renderer-facing channel names (preload relay + port request). */
export const NODE_HOST_PORT_CHANNEL = "posthog-node-host-port";
export const NODE_HOST_PORT_REQUEST = "posthog-node-host-port-request";
