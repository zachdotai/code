import type { Tracer } from "@opentelemetry/api";
import {
  initNodeTracing,
  type NodeTracing,
} from "@posthog/workspace-server/node-tracing";
import { getAppVersion } from "./env";

let current: NodeTracing | null = null;

export function initOtelTracing(): Tracer | null {
  current = initNodeTracing({
    serviceName: "posthog-code-desktop",
    serviceVersion: getAppVersion(),
    attributes: {
      "service.namespace": "ipc",
      "process.runtime.name": "electron",
      "process.runtime.version": process.versions.electron,
    },
  });
  return current?.tracer ?? null;
}

export function getMainTracer(): Tracer | null {
  return current?.tracer ?? null;
}

export async function shutdownOtelTracing(): Promise<void> {
  await current?.shutdown();
  current = null;
}
