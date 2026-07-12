import type { ScopedLogger } from "@posthog/di/logger";
import type { HostCapabilitiesRouter } from "@posthog/host-router/routers/host-capabilities.router";
import { createPortBridge, portLink } from "@posthog/port-trpc/link";
import type { TransportPort } from "@posthog/port-trpc/transport-port";
import type {
  AgentAuth,
  AgentKnownFolders,
  AgentMcpApps,
  AgentPluginDir,
  AgentPowerMonitor,
  AgentRepoFiles,
  AgentSleepCoordinator,
  AgentWorkspaceDirectories,
  AgentWorktreeSettings,
} from "@posthog/workspace-server/services/agent/ports";
import type { AuthProxyAuth } from "@posthog/workspace-server/services/auth-proxy/ports";
import type { McpProxyAuth } from "@posthog/workspace-server/services/mcp-proxy/ports";
import { createTRPCClient, type TRPCClient } from "@trpc/client";

export type HostCapabilitiesClient = TRPCClient<HostCapabilitiesRouter>;

/** Typed client over the host-capabilities MessagePort main hands us at init. */
export function createHostCapabilitiesClient(
  port: TransportPort,
): HostCapabilitiesClient {
  const bridge = createPortBridge();
  bridge.connect(port);
  return createTRPCClient<HostCapabilitiesRouter>({
    links: [portLink({ bridge })],
  });
}

// Mirrors AuthService.authenticatedFetch in @posthog/core: bearer header, one
// refresh-and-retry on 401/403, and the same default timeout. Implemented
// locally so only the (tiny) token calls cross the control channel — the
// gateway/MCP proxies stream their response bodies without ever round-tripping
// them through main.
const AUTH_FETCH_TIMEOUT_MS = 30_000;

async function fetchWithBearer(
  fetchImpl: (input: string | Request, init?: RequestInit) => Promise<Response>,
  input: string | Request,
  init: RequestInit,
  accessToken: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  return fetchImpl(input, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
  });
}

export function createHostAgentAuth(
  hostCaps: HostCapabilitiesClient,
): AgentAuth {
  const getValidAccessToken = () => hostCaps.auth.getValidAccessToken.mutate();
  const refreshAccessToken = () => hostCaps.auth.refreshAccessToken.mutate();
  return {
    getValidAccessToken,
    refreshAccessToken,
    authenticatedFetch: async (fetchImpl, input, init = {}) => {
      const initialAuth = await getValidAccessToken();
      let response = await fetchWithBearer(
        fetchImpl,
        input,
        init,
        initialAuth.accessToken,
      );
      if (response.status === 401 || response.status === 403) {
        const refreshedAuth = await refreshAccessToken();
        response = await fetchWithBearer(
          fetchImpl,
          input,
          init,
          refreshedAuth.accessToken,
        );
      }
      return response;
    },
  };
}

export function createHostAuthProxyAuth(agentAuth: AgentAuth): AuthProxyAuth {
  return {
    authenticatedFetch: (url, init) =>
      agentAuth.authenticatedFetch(fetch, url, init),
  };
}

export function createHostMcpProxyAuth(agentAuth: AgentAuth): McpProxyAuth {
  return {
    authenticatedFetch: (url, init) =>
      agentAuth.authenticatedFetch(fetch, url, init),
    refreshAccessToken: () => agentAuth.refreshAccessToken(),
  };
}

export function createHostSleepCoordinator(
  hostCaps: HostCapabilitiesClient,
  log: ScopedLogger,
): AgentSleepCoordinator {
  const forward = (label: string, promise: Promise<unknown>) => {
    promise.catch((error) => log.warn(`sleep.${label} forward failed`, error));
  };
  return {
    acquire: (activityId) =>
      forward("acquire", hostCaps.sleep.acquire.mutate({ activityId })),
    release: (activityId) =>
      forward("release", hostCaps.sleep.release.mutate({ activityId })),
  };
}

export function createHostMcpApps(
  hostCaps: HostCapabilitiesClient,
  log: ScopedLogger,
): AgentMcpApps {
  const forward = (label: string, promise: Promise<unknown>) => {
    promise.catch((error) =>
      log.warn(`mcpApps.${label} forward failed`, error),
    );
  };
  return {
    handleDiscovery: (serverNames) =>
      hostCaps.mcpApps.handleDiscovery.mutate({ serverNames }),
    setServerConfigs: (configs) =>
      forward(
        "setServerConfigs",
        hostCaps.mcpApps.setServerConfigs.mutate({ configs }),
      ),
    notifyToolInput: (toolKey, toolCallId, args) =>
      forward(
        "notifyToolInput",
        hostCaps.mcpApps.notifyToolInput.mutate({ toolKey, toolCallId, args }),
      ),
    notifyToolResult: (toolKey, toolCallId, result, isError) =>
      forward(
        "notifyToolResult",
        hostCaps.mcpApps.notifyToolResult.mutate({
          toolKey,
          toolCallId,
          result,
          isError,
        }),
      ),
    notifyToolCancelled: (toolKey, toolCallId) =>
      forward(
        "notifyToolCancelled",
        hostCaps.mcpApps.notifyToolCancelled.mutate({ toolKey, toolCallId }),
      ),
    cleanup: () => hostCaps.mcpApps.cleanup.mutate(),
  };
}

export function createHostRepoFiles(
  hostCaps: HostCapabilitiesClient,
): AgentRepoFiles {
  return {
    readRepoFile: (repoPath, filePath) =>
      hostCaps.repoFiles.readRepoFile.query({ repoPath, filePath }),
    writeRepoFile: (repoPath, filePath, content) =>
      hostCaps.repoFiles.writeRepoFile.mutate({ repoPath, filePath, content }),
  };
}

export function createHostPluginDir(
  hostCaps: HostCapabilitiesClient,
): AgentPluginDir {
  return {
    getPluginPath: () => hostCaps.pluginDir.getPluginPath.query(),
  };
}

export function createHostWorkspaceDirectories(
  hostCaps: HostCapabilitiesClient,
): AgentWorkspaceDirectories {
  return {
    getAdditionalDirectories: (taskId) =>
      hostCaps.workspaceDirectories.getAdditionalDirectories.query({ taskId }),
  };
}

export function createHostWorktreeSettings(
  hostCaps: HostCapabilitiesClient,
): AgentWorktreeSettings {
  return {
    getWorktreeLocation: () =>
      hostCaps.worktreeSettings.getWorktreeLocation.query(),
  };
}

export function createHostKnownFolders(
  hostCaps: HostCapabilitiesClient,
): AgentKnownFolders {
  return {
    getFolders: () => hostCaps.knownFolders.getFolders.query(),
  };
}

export function createHostPowerMonitor(
  hostCaps: HostCapabilitiesClient,
): AgentPowerMonitor {
  return {
    onResume: (handler) => {
      const subscription = hostCaps.power.onResume.subscribe(undefined, {
        onData: () => handler(),
        onError: () => {},
      });
      return () => subscription.unsubscribe();
    },
  };
}
