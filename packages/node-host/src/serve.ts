import "reflect-metadata";
import dns from "node:dns";
import net from "node:net";
import path from "node:path";
import type { HostContext, ServiceResolver } from "@posthog/host-trpc/context";
import {
  attachPortServer,
  type PortServerHandle,
} from "@posthog/port-trpc/server";
import {
  fromMessagePortMain,
  type MessagePortMainLike,
} from "@posthog/port-trpc/transport-port";
import {
  isNodeHostToChildMessage,
  type NodeHostFromChildMessage,
  type NodeHostRendererPortMessage,
} from "@posthog/shared/node-host-protocol";
import type { AgentService } from "@posthog/workspace-server/services/agent/agent";
import { AGENT_SERVICE } from "@posthog/workspace-server/services/agent/identifiers";
import { PROCESS_TRACKING_SERVICE } from "@posthog/workspace-server/services/process-tracking/identifiers";
import type { ProcessTrackingService } from "@posthog/workspace-server/services/process-tracking/process-tracking";
import { createNodeHostContainer, type NodeHostContainer } from "./container";
import { createHostCapabilitiesClient } from "./host-capabilities";
import { createStdoutLogger } from "./logger";
import { nodeHostRouter } from "./router";

const SHUTDOWN_GRACE_MS = 3_000;

// Electron adds parentPort to utilityProcess children; typed structurally so
// this package never imports electron and stays loadable in plain-node tests.
interface UtilityParentPort {
  on(
    event: "message",
    listener: (event: { data: unknown; ports: MessagePortMainLike[] }) => void,
  ): unknown;
  postMessage(message: NodeHostFromChildMessage): void;
}

const parentPort = (process as unknown as { parentPort?: UtilityParentPort })
  .parentPort;

// The flat .vite/build layout code-splits several process entries in one
// rollup graph, and rollup may import THIS entry chunk from a sibling chunk
// (the Electron main process, the workspace-server child) to reach modules
// they share. parentPort only exists in a real utilityProcess child: run
// there, fail fast on a genuine mis-spawn (executed as the entry script but
// without a parentPort), and stay inert on a bare chunk import.
const entryScript = process.argv[1];
if (parentPort) {
  runNodeHost(parentPort);
} else if (
  entryScript !== undefined &&
  path.basename(entryScript) === "node-host.js"
) {
  process.stderr.write(
    "[node-host] no parentPort — this entry must be forked as an Electron utilityProcess\n",
  );
  process.exit(2);
}

function runNodeHost(utilityPort: UtilityParentPort): void {
  // Prefer IPv4 and disable "Happy Eyeballs" (mirrors apps/code main bootstrap
  // and the workspace-server child). This process makes all agent HTTPS calls
  // to PostHog/the gateway; its many-address ELB times out when IPv6 is
  // unreachable.
  dns.setDefaultResultOrder("ipv4first");
  net.setDefaultAutoSelectFamily(false);

  const logger = createStdoutLogger();
  const log = logger.scope("serve");

  interface Runtime {
    container: NodeHostContainer;
    /** The container as the narrow tRPC context view (composition-seam cast). */
    hostContext: HostContext;
    controlServer: PortServerHandle;
    rendererServers: Map<number, PortServerHandle>;
  }

  let runtime: Runtime | null = null;
  let shuttingDown = false;

  function initialize(ports: MessagePortMainLike[]): void {
    if (runtime) {
      log.warn("duplicate init message ignored");
      return;
    }
    const [controlPort, hostCapsPort] = ports;
    if (!controlPort || !hostCapsPort) {
      log.error("init message did not carry control + host-capabilities ports");
      process.exit(2);
    }

    const hostCaps = createHostCapabilitiesClient(
      fromMessagePortMain(hostCapsPort),
    );
    const container = createNodeHostContainer({
      hostCaps,
      logger,
      env: process.env,
    });
    const hostContext: HostContext = {
      container: container as unknown as ServiceResolver,
    };

    const controlServer = attachPortServer({
      router: nodeHostRouter,
      port: fromMessagePortMain(controlPort),
      createContext: () => hostContext,
      onError: ({ error, path: procedurePath }) =>
        log.warn("control procedure failed", procedurePath, error.message),
    });

    runtime = {
      container,
      hostContext,
      controlServer,
      rendererServers: new Map(),
    };
    utilityPort.postMessage({ type: "node-host:ready" });
    log.info("ready");
  }

  function attachRendererPort(
    message: NodeHostRendererPortMessage,
    rendererPort: MessagePortMainLike | undefined,
  ): void {
    if (!runtime || !rendererPort) return;
    // A window re-requesting a port (reload, or a supervisor reissue) replaces
    // its predecessor; disposing the old attachment aborts its subscriptions.
    const { hostContext, rendererServers } = runtime;
    rendererServers.get(message.webContentsId)?.dispose();
    const handle = attachPortServer({
      router: nodeHostRouter,
      port: fromMessagePortMain(rendererPort),
      createContext: () => hostContext,
      onError: ({ error, path: procedurePath }) =>
        log.warn("renderer procedure failed", procedurePath, error.message),
    });
    rendererServers.set(message.webContentsId, handle);
    log.info("renderer port attached", {
      webContentsId: message.webContentsId,
      generation: message.generation,
    });
  }

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutdown requested");
    const forceExit = setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS);
    forceExit.unref();
    try {
      if (runtime) {
        await runtime.container.get<AgentService>(AGENT_SERVICE).cleanupAll();
        runtime.container
          .get<ProcessTrackingService>(PROCESS_TRACKING_SERVICE)
          .killAll();
        for (const handle of runtime.rendererServers.values()) {
          handle.dispose();
        }
        runtime.controlServer.dispose();
      }
    } catch (error) {
      log.warn("shutdown cleanup failed", error);
    }
    process.exit(0);
  }

  utilityPort.on("message", (event) => {
    const message = event.data;
    if (!isNodeHostToChildMessage(message)) return;
    switch (message.type) {
      case "node-host:init":
        initialize(event.ports);
        break;
      case "node-host:renderer-port":
        attachRendererPort(message, event.ports[0]);
        break;
      case "node-host:ping":
        utilityPort.postMessage({ type: "node-host:pong" });
        break;
      case "node-host:shutdown":
        void shutdown();
        break;
    }
  });
}
