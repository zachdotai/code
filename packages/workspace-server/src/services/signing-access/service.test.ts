import type { IWorkspaceSettings } from "@posthog/platform/workspace-settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SecureEnclaveSigningAccessService } from "./service";

interface SigningAccessServiceInternals {
  ensureBroker(): Promise<void>;
  request(payload: Record<string, string>): Promise<{
    ok: boolean;
    error?: string;
    publicKey?: string;
    socketPath?: string;
  }>;
}

function createService(enabled = false, isProduction = false) {
  const workspaceSettings = {
    getSecureEnclaveSigningEnabled: vi.fn(() => enabled),
    setSecureEnclaveSigningEnabled: vi.fn(),
  } as unknown as IWorkspaceSettings;
  const service = new SecureEnclaveSigningAccessService(
    { resolve: vi.fn((path: string) => `/bundle/${path}`) },
    {
      version: "0.0.0-test",
      isProduction,
      platform: "darwin",
      arch: "arm64",
    },
    {
      appDataPath: "/app-data",
      logsPath: "/logs",
      logFolderPath: "/logs",
    },
    workspaceSettings,
    {
      scope: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    },
  );
  return { service, workspaceSettings };
}

describe("SecureEnclaveSigningAccessService", () => {
  const originalOverride = process.env.POSTHOG_CODE_SECURE_ENCLAVE_SIGNING;

  beforeEach(() => {
    delete process.env.POSTHOG_CODE_SECURE_ENCLAVE_SIGNING;
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  });

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.POSTHOG_CODE_SECURE_ENCLAVE_SIGNING;
    } else {
      process.env.POSTHOG_CODE_SECURE_ENCLAVE_SIGNING = originalOverride;
    }
    vi.restoreAllMocks();
  });

  it("does not acquire signing access while disabled", async () => {
    const { service } = createService(false);

    await expect(service.acquire("run-1")).resolves.toBeNull();
  });

  it("returns the public key from the broker status response", async () => {
    const { service } = createService(true);
    const internals = service as unknown as SigningAccessServiceInternals;
    vi.spyOn(internals, "ensureBroker").mockResolvedValue(undefined);
    vi.spyOn(internals, "request").mockResolvedValue({
      ok: true,
      publicKey: "ecdsa-sha2-nistp256 AAAATEST",
    });

    await expect(service.getStatus()).resolves.toEqual({
      supported: true,
      enabled: true,
      publicKey: "ecdsa-sha2-nistp256 AAAATEST",
      error: null,
    });
  });

  it("explains that local code signing is required", async () => {
    const { service } = createService(true);
    const internals = service as unknown as SigningAccessServiceInternals;
    vi.spyOn(internals, "ensureBroker").mockRejectedValue(
      new Error("OSStatus error -34018 - failed to add key to keychain"),
    );

    await expect(service.getStatus()).resolves.toMatchObject({
      publicKey: null,
      error: expect.stringContaining("Local code signing must be configured"),
    });
  });

  it("does not expose development signing guidance in production", async () => {
    const { service } = createService(true, true);
    const internals = service as unknown as SigningAccessServiceInternals;
    vi.spyOn(internals, "ensureBroker").mockRejectedValue(
      new Error("OSStatus error -34018 - failed to add key to keychain"),
    );

    const status = await service.getStatus();

    expect(status.error).toBe(
      "Secure Enclave signing is unavailable. Please restart PostHog Code and try again.",
    );
    expect(status.error).not.toContain("development build");
    expect(status.error).not.toContain("code signing");
  });

  it("persists enablement before returning the refreshed status", async () => {
    const { service, workspaceSettings } = createService(false);
    vi.spyOn(service, "getStatus").mockResolvedValue({
      supported: true,
      enabled: true,
      publicKey: "ecdsa-sha2-nistp256 AAAATEST",
      error: null,
    });

    await expect(service.setEnabled(true)).resolves.toMatchObject({
      enabled: true,
    });
    expect(
      workspaceSettings.setSecureEnclaveSigningEnabled,
    ).toHaveBeenCalledWith(true);
  });

  it("removes its Git environment when disabled", async () => {
    const { service } = createService(true);
    const internals = service as unknown as SigningAccessServiceInternals;
    process.env.SSH_AUTH_SOCK = "/original.sock";
    vi.spyOn(internals, "ensureBroker").mockResolvedValue(undefined);
    vi.spyOn(internals, "request").mockResolvedValue({
      ok: true,
      publicKey: "ecdsa-sha2-nistp256 AAAATEST",
      socketPath: "/managed.sock",
    });
    const lease = await service.acquire("run-1");
    await lease?.registerProcess(1234);
    await lease?.unregisterProcess(1234);
    expect(internals.request).toHaveBeenCalledWith({
      action: "register",
      agentId: "run-1",
      pid: "1234",
    });
    expect(internals.request).toHaveBeenCalledWith({
      action: "unregister",
      agentId: "run-1",
      pid: "1234",
    });
    vi.spyOn(service, "getStatus").mockResolvedValue({
      supported: true,
      enabled: false,
      publicKey: "ecdsa-sha2-nistp256 AAAATEST",
      error: null,
    });

    await service.setEnabled(false);

    expect(process.env.GIT_CONFIG_COUNT).toBe("0");
    expect(process.env.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(process.env.SSH_AUTH_SOCK).toBe("/original.sock");
  });
});
