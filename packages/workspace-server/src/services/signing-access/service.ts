import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import { join } from "node:path";
import { APP_META_SERVICE, type IAppMeta } from "@posthog/platform/app-meta";
import {
  BUNDLED_RESOURCES_SERVICE,
  type IBundledResources,
} from "@posthog/platform/bundled-resources";
import {
  type IStoragePaths,
  STORAGE_PATHS_SERVICE,
} from "@posthog/platform/storage-paths";
import {
  type IWorkspaceSettings,
  WORKSPACE_SETTINGS_SERVICE,
} from "@posthog/platform/workspace-settings";
import { inject, injectable, preDestroy } from "inversify";
import { AGENT_LOGGER } from "../agent/identifiers";
import type { AgentLogger, AgentScopedLogger } from "../agent/ports";
import type {
  SigningAccessLease,
  SigningAccessService,
  SigningAccessStatus,
} from "./contracts";

interface BrokerResponse {
  ok: boolean;
  error?: string;
  publicKey?: string;
  socketPath?: string;
}

const BROKER_START_TIMEOUT_MS = 5_000;
const CONTROL_REQUEST_TIMEOUT_MS = 5_000;
const MISSING_KEYCHAIN_ENTITLEMENT_ERROR = "OSStatus error -34018";
const SIGNING_IDENTITY_GUIDANCE =
  "Local code signing must be configured before Secure Enclave signing can be used in a development build.";
const PRODUCTION_SIGNING_ERROR =
  "Secure Enclave signing is unavailable. Please restart PostHog Code and try again.";

@injectable()
export class SecureEnclaveSigningAccessService implements SigningAccessService {
  private readonly log: AgentScopedLogger;
  private broker: ChildProcess | null = null;
  private controlToken: string | null = null;
  private gitEnvironmentConfigured = false;
  private gitEnvironmentStartIndex: number | null = null;
  private previousSshAuthSock: string | undefined;
  private startPromise: Promise<void> | null = null;

  constructor(
    @inject(BUNDLED_RESOURCES_SERVICE)
    private readonly bundledResources: IBundledResources,
    @inject(APP_META_SERVICE)
    private readonly appMeta: IAppMeta,
    @inject(STORAGE_PATHS_SERVICE)
    private readonly storagePaths: IStoragePaths,
    @inject(WORKSPACE_SETTINGS_SERVICE)
    private readonly workspaceSettings: IWorkspaceSettings,
    @inject(AGENT_LOGGER)
    loggerFactory: AgentLogger,
  ) {
    this.log = loggerFactory.scope("secure-enclave-signing");
  }

  async getStatus(): Promise<SigningAccessStatus> {
    if (process.platform !== "darwin") {
      return {
        supported: false,
        enabled: false,
        publicKey: null,
        error: "Managed Secure Enclave signing is only available on macOS.",
      };
    }

    const enabled = this.isEnabled;
    try {
      await this.ensureBroker();
      const response = await this.request({ action: "status" });
      if (!response.ok || !response.publicKey) {
        return {
          supported: true,
          enabled,
          publicKey: null,
          error:
            response.error ??
            "The Secure Enclave signing key is not available right now.",
        };
      }
      return {
        supported: true,
        enabled,
        publicKey: response.publicKey,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        supported: true,
        enabled,
        publicKey: null,
        error: message.includes(MISSING_KEYCHAIN_ENTITLEMENT_ERROR)
          ? this.appMeta.isProduction
            ? PRODUCTION_SIGNING_ERROR
            : SIGNING_IDENTITY_GUIDANCE
          : message,
      };
    }
  }

  async setEnabled(enabled: boolean): Promise<SigningAccessStatus> {
    if (process.platform === "darwin") {
      this.workspaceSettings.setSecureEnclaveSigningEnabled(enabled);
      if (!enabled && process.env.POSTHOG_CODE_SECURE_ENCLAVE_SIGNING !== "1") {
        this.clearGitEnvironment();
      }
    }
    return this.getStatus();
  }

  async acquire(agentId: string): Promise<SigningAccessLease | null> {
    if (process.platform !== "darwin" || !this.isEnabled) {
      return null;
    }

    try {
      await this.ensureBroker();
    } catch (error) {
      this.log.warn(
        "Secure Enclave signing is unavailable; the agent will continue without managed signing",
        { error: error instanceof Error ? error.message : String(error) },
      );
      return null;
    }
    let response: BrokerResponse;
    try {
      response = await this.request({ action: "acquire", agentId });
    } catch (error) {
      this.log.warn(
        "Secure Enclave signing access could not be acquired; the agent will continue",
        { error: error instanceof Error ? error.message : String(error) },
      );
      return null;
    }
    if (!response.ok || !response.socketPath || !response.publicKey) {
      this.log.warn(
        "Secure Enclave signing access is unavailable; the agent will continue",
        {
          error:
            response.error ??
            "The Secure Enclave is not available right now. Please continue working; signing will become available when the user returns and unlocks the device.",
        },
      );
      return null;
    }

    let released = false;
    if (!this.gitEnvironmentConfigured) {
      this.previousSshAuthSock = process.env.SSH_AUTH_SOCK;
    }
    process.env.SSH_AUTH_SOCK = response.socketPath;
    const signingProgram = this.bundledResources.resolve(
      ".vite/build/signing-agent/posthog-code-ssh-keygen",
    );
    const gitConfig = {
      "gpg.format": "ssh",
      "gpg.ssh.program": signingProgram,
      "user.signingkey": response.publicKey,
    };
    if (!this.gitEnvironmentConfigured) {
      this.applyGitConfigEnvironment(gitConfig);
      this.gitEnvironmentConfigured = true;
    }
    return {
      socketPath: response.socketPath,
      gitConfig,
      registerProcess: async (pid) => {
        const result = await this.request({
          action: "register",
          agentId,
          pid: String(pid),
        });
        if (!result.ok) {
          throw new Error(result.error ?? "Failed to register signing process");
        }
      },
      unregisterProcess: async (pid) => {
        const result = await this.request({
          action: "unregister",
          agentId,
          pid: String(pid),
        });
        if (!result.ok) {
          throw new Error(
            result.error ?? "Failed to unregister signing process",
          );
        }
      },
      release: async () => {
        if (released) return;
        released = true;
        await this.request({ action: "release", agentId }).catch((error) => {
          this.log.warn("Failed to release signing access", {
            agentId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      },
    };
  }

  private applyGitConfigEnvironment(config: Record<string, string>): void {
    const startIndex = Number(process.env.GIT_CONFIG_COUNT ?? "0");
    this.gitEnvironmentStartIndex = startIndex;
    const entries = Object.entries(config);
    entries.forEach(([key, value], offset) => {
      const index = startIndex + offset;
      process.env[`GIT_CONFIG_KEY_${index}`] = key;
      process.env[`GIT_CONFIG_VALUE_${index}`] = value;
    });
    process.env.GIT_CONFIG_COUNT = String(startIndex + entries.length);
  }

  private clearGitEnvironment(): void {
    if (
      !this.gitEnvironmentConfigured ||
      this.gitEnvironmentStartIndex === null
    ) {
      return;
    }

    const removedCount = 3;
    const currentCount = Number(process.env.GIT_CONFIG_COUNT ?? "0");
    for (
      let sourceIndex = this.gitEnvironmentStartIndex + removedCount;
      sourceIndex < currentCount;
      sourceIndex += 1
    ) {
      const targetIndex = sourceIndex - removedCount;
      process.env[`GIT_CONFIG_KEY_${targetIndex}`] =
        process.env[`GIT_CONFIG_KEY_${sourceIndex}`];
      process.env[`GIT_CONFIG_VALUE_${targetIndex}`] =
        process.env[`GIT_CONFIG_VALUE_${sourceIndex}`];
    }
    for (
      let index = Math.max(
        this.gitEnvironmentStartIndex,
        currentCount - removedCount,
      );
      index < currentCount;
      index += 1
    ) {
      delete process.env[`GIT_CONFIG_KEY_${index}`];
      delete process.env[`GIT_CONFIG_VALUE_${index}`];
    }
    process.env.GIT_CONFIG_COUNT = String(
      Math.max(this.gitEnvironmentStartIndex, currentCount - removedCount),
    );

    if (this.previousSshAuthSock === undefined) {
      delete process.env.SSH_AUTH_SOCK;
    } else {
      process.env.SSH_AUTH_SOCK = this.previousSshAuthSock;
    }
    this.previousSshAuthSock = undefined;
    this.gitEnvironmentConfigured = false;
    this.gitEnvironmentStartIndex = null;
  }

  @preDestroy()
  dispose(): void {
    this.clearGitEnvironment();
    this.broker?.kill("SIGTERM");
    this.broker = null;
    this.controlToken = null;
  }

  private get runtimeDirectory(): string {
    return join(this.storagePaths.appDataPath, "secure-enclave-signing");
  }

  private get isEnabled(): boolean {
    return (
      process.env.POSTHOG_CODE_SECURE_ENCLAVE_SIGNING === "1" ||
      this.workspaceSettings.getSecureEnclaveSigningEnabled()
    );
  }

  private get controlSocketPath(): string {
    return join(this.runtimeDirectory, "control.sock");
  }

  private async ensureBroker(): Promise<void> {
    if (this.broker && this.broker.exitCode === null) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise<void>((resolve, reject) => {
      const binaryPath = this.bundledResources.resolve(
        ".vite/build/signing-agent/posthog-code-signing-agent",
      );
      const controlToken = randomBytes(32).toString("hex");
      this.controlToken = controlToken;
      const broker = spawn(
        binaryPath,
        ["serve", this.runtimeDirectory, String(process.pid)],
        {
          detached: false,
          stdio: ["pipe", "ignore", "pipe"],
        },
      );
      broker.stdin?.end(`${controlToken}\n`);
      this.broker = broker;
      broker.once("error", reject);

      let stderr = "";
      broker.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });

      const deadline = Date.now() + BROKER_START_TIMEOUT_MS;
      const poll = (): void => {
        if (broker.exitCode !== null) {
          reject(
            new Error(
              stderr.trim() ||
                `Secure Enclave signing broker exited with code ${broker.exitCode}`,
            ),
          );
          return;
        }
        this.request({ action: "status" })
          .then(() => resolve())
          .catch((error) => {
            if (Date.now() >= deadline) {
              reject(error);
            } else {
              setTimeout(poll, 50);
            }
          });
      };
      poll();
    }).finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  private request(payload: Record<string, string>): Promise<BrokerResponse> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.controlSocketPath);
      let response = "";
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("Secure Enclave signing broker did not respond"));
      }, CONTROL_REQUEST_TIMEOUT_MS);
      timeout.unref();

      socket.setEncoding("utf8");
      socket.on("connect", () => {
        socket.end(
          `${JSON.stringify({ ...payload, token: this.controlToken })}\n`,
        );
      });
      socket.on("data", (chunk) => {
        response += chunk;
      });
      socket.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      socket.on("end", () => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(response) as BrokerResponse);
        } catch {
          reject(
            new Error("Secure Enclave signing broker returned invalid data"),
          );
        }
      });
    });
  }
}
