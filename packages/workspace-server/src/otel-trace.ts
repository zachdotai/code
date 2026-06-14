import type { Tracer } from "@opentelemetry/api";
import { initNodeTracing, type NodeTracing } from "./node-tracing";

let current: NodeTracing | null = null;

export function initOtelTracing(): Tracer | null {
  current = initNodeTracing({
    serviceName: "posthog-code-workspace-server",
    serviceVersion: process.env.POSTHOG_CODE_VERSION ?? "unknown",
    attributes: {
      "process.runtime.name": "node",
      "process.runtime.version": process.versions.node,
    },
  });
  return current?.tracer ?? null;
}

export function getWorkspaceServerTracer(): Tracer | null {
  return current?.tracer ?? null;
}

export async function shutdownOtelTracing(): Promise<void> {
  await current?.shutdown();
  current = null;
}
