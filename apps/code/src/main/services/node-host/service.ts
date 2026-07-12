import path, { dirname } from "node:path";
import { hostCapabilitiesRouter } from "@posthog/host-router/routers/host-capabilities.router";
import type { ServiceResolver } from "@posthog/host-trpc/context";
import type { NodeHostRouter } from "@posthog/node-host/router";
import { createPortBridge, portLink } from "@posthog/port-trpc/link";
import {
  attachPortServer,
  type PortServerHandle,
} from "@posthog/port-trpc/server";
import { fromMessagePortMain } from "@posthog/port-trpc/transport-port";
import { TypedEventEmitter } from "@posthog/shared";
import { POSTHOG_CODE_INTERNAL_CHILD_ENV } from "@posthog/shared/constants";
import {
  isNodeHostFromChildMessage,
  NODE_HOST_PORT_CHANNEL,
  type NodeHostToChildMessage,
} from "@posthog/shared/node-host-protocol";
import { createTRPCClient, type TRPCClient } from "@trpc/client";
import {
  app,
  MessageChannelMain,
  type UtilityProcess,
  utilityProcess,
  type WebContents,
} from "electron";
import { injectable } from "inversify";
import { getLogFilePath, logger } from "../../utils/logger.js";

const READY_TIMEOUT_MS = 10_000;
const SHUTDOWN_GRACE_MS = 3_000;
const PING_INTERVAL_MS = 15_000;
const MAX_MISSED_PONGS = 2;

const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BASE_DELAY_MS = 500;
const RESTART_MAX_DELAY_MS = 30_000;

const log = logger.scope("node-host");

export const NodeHostStatus = {
  Idle: "idle",
  Starting: "starting",
  Ready: "ready",
  Retrying: "retrying",
  Failed: "failed",
} as const;

export type NodeHostStatus =
  (typeof NodeHostStatus)[keyof typeof NodeHostStatus];

export const NodeHostEvent = {
  StatusChanged: "statusChanged",
} as const;

export interface NodeHostEvents {
  [NodeHostEvent.StatusChanged]: {
    status: NodeHostStatus;
    attempt: number;
    error?: string;
  };
}

export type NodeHostClient = TRPCClient<NodeHostRouter>;

/**
 * Supervises the node-host utilityProcess that runs agent execution off the
 * main process. Modeled on WorkspaceServerService (status machine, exponential
 * backoff restart, stdio piped into the app log), but connected over
 * MessagePorts instead of localhost HTTP: each spawn gets a control channel
 * (main is a client of the node host's routers — a single PortBridge-backed
 * tRPC client survives restarts by swapping ports) and a host-capabilities
 * channel (main serves the narrow capability surface the moved AgentService
 * still needs). Renderer windows additionally get their own direct port so
 * agent event streams bypass main entirely.
 */
@injectable()
export class NodeHostService extends TypedEventEmitter<NodeHostEvents> {
  private readonly scriptPath = path.join(__dirname, "node-host.js");
  #child: UtilityProcess | null = null;
  #resolver: ServiceResolver | null = null;
  #generation = 0;
  #status: NodeHostStatus = NodeHostStatus.Idle;
  #restartAttempts = 0;
  #restartTimer: NodeJS.Timeout | null = null;
  #pendingStart: Promise<void> | null = null;
  #stopping = false;

  #hostCapsServer: PortServerHandle | null = null;
  #pingTimer: NodeJS.Timeout | null = null;
  #missedPongs = 0;
  #pongPending = false;

  // Renderer webContents that asked for a port; re-issued after a restart so
  // their bridges swap onto the fresh process.
  #portRequesters = new Set<WebContents>();

  readonly #controlBridge = createPortBridge();
  readonly #controlClient: NodeHostClient = createTRPCClient<NodeHostRouter>({
    links: [portLink({ bridge: this.#controlBridge })],
  });

  /**
   * The main-process client of the node host's routers. Valid across restarts:
   * operations queue until the first spawn connects, and a restart fails
   * in-flight calls (callers see a connection-reset error) before new traffic
   * flows to the fresh process.
   */
  getClient(): NodeHostClient {
    return this.#controlClient;
  }

  getStatus(): NodeHostStatus {
    return this.#status;
  }

  getStatusSnapshot(): { status: NodeHostStatus; attempt: number } {
    return { status: this.#status, attempt: this.#restartAttempts };
  }

  /**
   * @param resolver main's DI container; it becomes the tRPC context for the
   * host-capabilities router served to the utility (composition seam — passed
   * in from index.ts rather than resolved here).
   */
  start(resolver: ServiceResolver): Promise<void> {
    this.#resolver = resolver;
    if (this.#child) return Promise.resolve();
    if (this.#pendingStart) return this.#pendingStart;

    this.#stopping = false;
    this.#clearRestartTimer();
    this.#pendingStart = this.#runStart();
    return this.#pendingStart;
  }

  stop(): void {
    this.#stopping = true;
    this.#clearRestartTimer();
    this.#stopPing();
    this.#restartAttempts = 0;
    this.#setStatus(NodeHostStatus.Idle);

    const child = this.#child;
    this.#child = null;
    if (child) {
      this.#sendToChild(child, { type: "node-host:shutdown" });
      setTimeout(() => {
        try {
          child.kill();
        } catch {}
      }, SHUTDOWN_GRACE_MS).unref();
    }
    this.#hostCapsServer?.dispose();
    this.#hostCapsServer = null;
  }

  /** User-initiated restart: resets the attempt budget like WorkspaceServerService. */
  restart(): Promise<void> {
    if (!this.#resolver) {
      return Promise.reject(new Error("node-host was never started"));
    }
    this.#stopping = false;
    this.#clearRestartTimer();
    this.#restartAttempts = 0;
    const child = this.#child;
    this.#child = null;
    if (child) {
      try {
        child.kill();
      } catch {}
    }
    return this.start(this.#resolver);
  }

  /**
   * Hand `target` a MessagePort wired directly to the node host. One half goes
   * to the utility (keyed by webContentsId so a replacement disposes its
   * predecessor), the other to the renderer via the preload relay. Re-run for
   * every live requester after a restart.
   */
  issueRendererPort(target: WebContents): void {
    if (!this.#portRequesters.has(target)) {
      this.#portRequesters.add(target);
      target.once("destroyed", () => {
        this.#portRequesters.delete(target);
      });
    }

    const child = this.#child;
    if (!child || this.#status !== NodeHostStatus.Ready) {
      // Issued on Ready — the requester set carries the intent across spawn.
      return;
    }

    const channel = new MessageChannelMain();
    this.#sendToChild(
      child,
      {
        type: "node-host:renderer-port",
        generation: this.#generation,
        webContentsId: target.id,
      },
      [channel.port1],
    );
    target.postMessage(
      NODE_HOST_PORT_CHANNEL,
      { generation: this.#generation },
      [channel.port2],
    );
  }

  async #runStart(): Promise<void> {
    if (this.#restartAttempts === 0) {
      this.#setStatus(NodeHostStatus.Starting);
    }
    try {
      await this.#spawnChild();
      this.#restartAttempts = 0;
      this.#pendingStart = null;
      this.#setStatus(NodeHostStatus.Ready);
      for (const target of this.#portRequesters) {
        if (!target.isDestroyed()) {
          this.issueRendererPort(target);
        }
      }
    } catch (error) {
      this.#pendingStart = null;
      this.#scheduleRestart(error);
      throw error;
    }
  }

  #scheduleRestart(error?: unknown): void {
    if (this.#stopping) return;
    if (this.#pendingStart || this.#restartTimer) return;

    if (this.#restartAttempts >= MAX_RESTART_ATTEMPTS) {
      this.#setStatus(NodeHostStatus.Failed, errorMessage(error));
      return;
    }

    this.#restartAttempts++;
    const delay = Math.min(
      RESTART_BASE_DELAY_MS * 2 ** (this.#restartAttempts - 1),
      RESTART_MAX_DELAY_MS,
    );
    this.#setStatus(NodeHostStatus.Retrying, errorMessage(error));
    log.info("scheduling node-host restart", {
      attempt: this.#restartAttempts,
      delayMs: delay,
    });
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      if (this.#resolver) {
        void this.start(this.#resolver).catch(() => {});
      }
    }, delay);
    this.#restartTimer.unref();
  }

  #clearRestartTimer(): void {
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }
  }

  #setStatus(status: NodeHostStatus, error?: string): void {
    this.#status = status;
    this.emit(NodeHostEvent.StatusChanged, {
      status,
      attempt: this.#restartAttempts,
      error,
    });
  }

  #sendToChild(
    child: UtilityProcess,
    message: NodeHostToChildMessage,
    transfer?: Electron.MessagePortMain[],
  ): void {
    try {
      child.postMessage(message, transfer);
    } catch (error) {
      log.warn("postMessage to node-host failed", { error });
    }
  }

  #childEnv(): Record<string, string> {
    const appPath = app.isPackaged
      ? `${app.getAppPath()}.unpacked`
      : app.getAppPath();
    return {
      POSTHOG_CODE_APP_PATH: appPath,
      POSTHOG_CODE_LOGS_PATH: app.getPath("logs"),
      POSTHOG_CODE_LOG_FOLDER_PATH: dirname(getLogFilePath()),
    };
  }

  async #spawnChild(): Promise<void> {
    const resolver = this.#resolver;
    if (!resolver) throw new Error("node-host start() requires a resolver");

    const generation = ++this.#generation;
    const child = utilityProcess.fork(this.scriptPath, [], {
      serviceName: "posthog-node-host",
      stdio: "pipe",
      env: {
        ...process.env,
        [POSTHOG_CODE_INTERNAL_CHILD_ENV]: "1",
        ...this.#childEnv(),
      } as Record<string, string>,
    });
    this.#child = child;

    child.stdout?.on("data", (chunk: Buffer) => {
      log.info(chunk.toString().trimEnd());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      log.warn(chunk.toString().trimEnd());
    });

    child.on("message", (message: unknown) => {
      if (
        isNodeHostFromChildMessage(message) &&
        message.type === "node-host:pong"
      ) {
        this.#missedPongs = 0;
        this.#pongPending = false;
      }
    });

    child.once("exit", (code) => {
      if (this.#child !== child) return;
      this.#child = null;
      this.#stopPing();
      log.info("node-host exited", { code });
      if (!this.#stopping) {
        this.#scheduleRestart(new Error(`node-host exited with code ${code}`));
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("node-host spawn timed out")),
        READY_TIMEOUT_MS,
      );
      child.once("spawn", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`node-host exited before spawn (code ${code})`));
      });
    });

    const control = new MessageChannelMain();
    const hostCaps = new MessageChannelMain();

    this.#hostCapsServer?.dispose();
    this.#hostCapsServer = attachPortServer({
      router: hostCapabilitiesRouter,
      port: fromMessagePortMain(hostCaps.port1),
      createContext: async () => ({ container: resolver }),
      onError: ({ error, path: procedurePath }) =>
        log.warn("host-capability procedure failed", {
          path: procedurePath,
          error: error.message,
        }),
    });

    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(new Error(`node-host not ready within ${READY_TIMEOUT_MS}ms`)),
        READY_TIMEOUT_MS,
      );
      const onMessage = (message: unknown) => {
        if (
          isNodeHostFromChildMessage(message) &&
          message.type === "node-host:ready"
        ) {
          clearTimeout(timeout);
          child.removeListener("message", onMessage);
          resolve();
        }
      };
      child.on("message", onMessage);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        child.removeListener("message", onMessage);
        reject(new Error(`node-host exited before ready (code ${code})`));
      });
    });

    this.#sendToChild(child, { type: "node-host:init", generation }, [
      control.port2,
      hostCaps.port2,
    ]);

    try {
      await ready;
    } catch (error) {
      try {
        child.kill();
      } catch {}
      throw error;
    }

    this.#controlBridge.connect(fromMessagePortMain(control.port1), generation);
    this.#startPing(child);
    log.info("node-host ready", { generation, pid: child.pid });
  }

  #startPing(child: UtilityProcess): void {
    this.#stopPing();
    this.#missedPongs = 0;
    this.#pongPending = false;
    this.#pingTimer = setInterval(() => {
      if (this.#child !== child) {
        this.#stopPing();
        return;
      }
      if (this.#pongPending) {
        this.#missedPongs++;
        if (this.#missedPongs >= MAX_MISSED_PONGS) {
          log.warn("node-host unresponsive, killing", {
            missedPongs: this.#missedPongs,
          });
          this.#stopPing();
          try {
            child.kill();
          } catch {}
          return;
        }
      }
      this.#pongPending = true;
      this.#sendToChild(child, { type: "node-host:ping" });
    }, PING_INTERVAL_MS);
    this.#pingTimer.unref();
  }

  #stopPing(): void {
    if (this.#pingTimer) {
      clearInterval(this.#pingTimer);
      this.#pingTimer = null;
    }
    this.#pongPending = false;
    this.#missedPongs = 0;
  }
}

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}
