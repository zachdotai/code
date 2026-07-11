import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import { join } from "node:path";
import {
  BUNDLED_RESOURCES_SERVICE,
  type IBundledResources,
} from "@posthog/platform/bundled-resources";
import {
  type IStoragePaths,
  STORAGE_PATHS_SERVICE,
} from "@posthog/platform/storage-paths";
import { inject, injectable, preDestroy } from "inversify";
import { AGENT_LOGGER } from "../agent/identifiers";
import type { AgentLogger, AgentScopedLogger } from "../agent/ports";
import type { SigningAccessLease, SigningAccessService } from "./contracts";

interface BrokerResponse {
  ok: boolean;
  error?: string;
  publicKey?: string;
  socketPath?: string;
}

const BROKER_START_TIMEOUT_MS = 5_000;
const CONTROL_REQUEST_TIMEOUT_MS = 5_000;

@injectable()
export class SecureEnclaveSigningAccessService implements SigningAccessService {
  private readonly log: AgentScopedLogger;
  private broker: ChildProcess | null = null;
  private controlToken: string | null = null;
  private gitEnvironmentConfigured = false;
  private startPromise: Promise<void> | null = null;

  constructor(
    @inject(BUNDLED_RESOURCES_SERVICE)
    private readonly bundledResources: IBundledResources,
    @inject(STORAGE_PATHS_SERVICE)
    private readonly storagePaths: IStoragePaths,
    @inject(AGENT_LOGGER)
    loggerFactory: AgentLogger,
  ) {
    this.log = loggerFactory.scope("secure-enclave-signing");
  }

  async acquire(agentId: string): Promise<SigningAccessLease | null> {
    if (
      process.platform !== "darwin" ||
      process.env.POSTHOG_CODE_SECURE_ENCLAVE_SIGNING !== "1"
    ) {
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
    const entries = Object.entries(config);
    entries.forEach(([key, value], offset) => {
      const index = startIndex + offset;
      process.env[`GIT_CONFIG_KEY_${index}`] = key;
      process.env[`GIT_CONFIG_VALUE_${index}`] = value;
    });
    process.env.GIT_CONFIG_COUNT = String(startIndex + entries.length);
  }

  @preDestroy()
  dispose(): void {
    this.broker?.kill("SIGTERM");
    this.broker = null;
    this.controlToken = null;
  }

  private get runtimeDirectory(): string {
    return join(this.storagePaths.appDataPath, "secure-enclave-signing");
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
        ["serve", this.runtimeDirectory, String(process.pid), controlToken],
        {
          detached: false,
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
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
