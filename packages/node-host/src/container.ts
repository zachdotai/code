import "reflect-metadata";
import { TypedContainer } from "@inversifyjs/strongly-typed";
import { SLEEP_SERVICE } from "@posthog/core/sleep/identifiers";
import type { SleepService } from "@posthog/core/sleep/sleep";
import { ROOT_LOGGER, type RootLogger } from "@posthog/di/logger";
import { APP_META_SERVICE, type IAppMeta } from "@posthog/platform/app-meta";
import {
  BUNDLED_RESOURCES_SERVICE,
  type IBundledResources,
} from "@posthog/platform/bundled-resources";
import {
  type IStoragePaths,
  STORAGE_PATHS_SERVICE,
} from "@posthog/platform/storage-paths";
import type { AgentService } from "@posthog/workspace-server/services/agent/agent";
import { agentModule } from "@posthog/workspace-server/services/agent/agent.module";
import type { AgentAuthAdapter } from "@posthog/workspace-server/services/agent/auth-adapter";
import {
  AGENT_AUTH,
  AGENT_AUTH_ADAPTER,
  AGENT_KNOWN_FOLDERS,
  AGENT_LOGGER,
  AGENT_MCP_APPS,
  AGENT_PLUGIN_DIR,
  AGENT_POWER_MONITOR,
  AGENT_REPO_FILES,
  AGENT_SERVICE,
  AGENT_SLEEP_COORDINATOR,
  AGENT_WORKSPACE_DIRECTORIES,
  AGENT_WORKTREE_SETTINGS,
} from "@posthog/workspace-server/services/agent/identifiers";
import type {
  AgentAuth,
  AgentKnownFolders,
  AgentLogger,
  AgentMcpApps,
  AgentPluginDir,
  AgentPowerMonitor,
  AgentRepoFiles,
  AgentSleepCoordinator,
  AgentWorkspaceDirectories,
  AgentWorktreeSettings,
} from "@posthog/workspace-server/services/agent/ports";
import type { AuthProxyService } from "@posthog/workspace-server/services/auth-proxy/auth-proxy";
import { authProxyModule } from "@posthog/workspace-server/services/auth-proxy/auth-proxy.module";
import {
  AUTH_PROXY_AUTH,
  AUTH_PROXY_SERVICE,
} from "@posthog/workspace-server/services/auth-proxy/identifiers";
import type { AuthProxyAuth } from "@posthog/workspace-server/services/auth-proxy/ports";
import {
  MCP_PROXY_AUTH,
  MCP_PROXY_SERVICE,
} from "@posthog/workspace-server/services/mcp-proxy/identifiers";
import type { McpProxyService } from "@posthog/workspace-server/services/mcp-proxy/mcp-proxy";
import { mcpProxyModule } from "@posthog/workspace-server/services/mcp-proxy/mcp-proxy.module";
import type { McpProxyAuth } from "@posthog/workspace-server/services/mcp-proxy/ports";
import { PROCESS_TRACKING_SERVICE } from "@posthog/workspace-server/services/process-tracking/identifiers";
import type { ProcessTrackingService } from "@posthog/workspace-server/services/process-tracking/process-tracking";
import { processTrackingModule } from "@posthog/workspace-server/services/process-tracking/process-tracking.module";
import { SHELL_SERVICE } from "@posthog/workspace-server/services/shell/identifiers";
import type { ShellService } from "@posthog/workspace-server/services/shell/shell";
import {
  createEnvAppMeta,
  createEnvBundledResources,
  createEnvStoragePaths,
} from "./env-platform";
import {
  createHostAgentAuth,
  createHostAuthProxyAuth,
  createHostKnownFolders,
  createHostMcpApps,
  createHostMcpProxyAuth,
  createHostPluginDir,
  createHostPowerMonitor,
  createHostRepoFiles,
  createHostSleepCoordinator,
  createHostWorkspaceDirectories,
  createHostWorktreeSettings,
  type HostCapabilitiesClient,
} from "./host-capabilities";

interface NodeHostBindings {
  [ROOT_LOGGER]: RootLogger;
  [AGENT_LOGGER]: AgentLogger;
  [AGENT_SERVICE]: AgentService;
  [AGENT_AUTH_ADAPTER]: AgentAuthAdapter;
  [PROCESS_TRACKING_SERVICE]: ProcessTrackingService;
  [AUTH_PROXY_SERVICE]: AuthProxyService;
  [MCP_PROXY_SERVICE]: McpProxyService;
  [AUTH_PROXY_AUTH]: AuthProxyAuth;
  [MCP_PROXY_AUTH]: McpProxyAuth;
  [AGENT_AUTH]: AgentAuth;
  [AGENT_SLEEP_COORDINATOR]: AgentSleepCoordinator;
  [AGENT_MCP_APPS]: AgentMcpApps;
  [AGENT_REPO_FILES]: AgentRepoFiles;
  [AGENT_PLUGIN_DIR]: AgentPluginDir;
  [AGENT_WORKSPACE_DIRECTORIES]: AgentWorkspaceDirectories;
  [AGENT_WORKTREE_SETTINGS]: AgentWorktreeSettings;
  [AGENT_KNOWN_FOLDERS]: AgentKnownFolders;
  [AGENT_POWER_MONITOR]: AgentPowerMonitor;
  [BUNDLED_RESOURCES_SERVICE]: IBundledResources;
  [APP_META_SERVICE]: IAppMeta;
  [STORAGE_PATHS_SERVICE]: IStoragePaths;
  // agentRouter.resetAll resolves these; here they are narrow stubs that
  // forward the one method it calls back to main over host capabilities.
  [SHELL_SERVICE]: Pick<ShellService, "destroyAll">;
  [SLEEP_SERVICE]: Pick<SleepService, "cleanup">;
}

export type NodeHostContainer = TypedContainer<NodeHostBindings>;

export function createNodeHostContainer({
  hostCaps,
  logger,
  env,
}: {
  hostCaps: HostCapabilitiesClient;
  logger: RootLogger;
  env: NodeJS.ProcessEnv;
}): NodeHostContainer {
  const container = new TypedContainer<NodeHostBindings>({
    defaultScope: "Singleton",
  });

  container.bind(ROOT_LOGGER).toConstantValue(logger);
  container.bind(AGENT_LOGGER).toConstantValue(logger);

  container
    .bind(BUNDLED_RESOURCES_SERVICE)
    .toConstantValue(createEnvBundledResources(env));
  container.bind(APP_META_SERVICE).toConstantValue(createEnvAppMeta(env));
  container
    .bind(STORAGE_PATHS_SERVICE)
    .toConstantValue(createEnvStoragePaths(env));

  // Moved services: they only need node + the auth ports below.
  container.load(processTrackingModule);
  container.load(authProxyModule);
  container.load(mcpProxyModule);
  container.load(agentModule);

  const agentAuth = createHostAgentAuth(hostCaps);
  container.bind(AGENT_AUTH).toConstantValue(agentAuth);
  container
    .bind(AUTH_PROXY_AUTH)
    .toConstantValue(createHostAuthProxyAuth(agentAuth));
  container
    .bind(MCP_PROXY_AUTH)
    .toConstantValue(createHostMcpProxyAuth(agentAuth));

  // Main-resident capabilities, proxied over the host-capabilities port.
  container
    .bind(AGENT_SLEEP_COORDINATOR)
    .toConstantValue(
      createHostSleepCoordinator(hostCaps, logger.scope("sleep")),
    );
  container
    .bind(AGENT_MCP_APPS)
    .toConstantValue(createHostMcpApps(hostCaps, logger.scope("mcp-apps")));
  container
    .bind(AGENT_REPO_FILES)
    .toConstantValue(createHostRepoFiles(hostCaps));
  container
    .bind(AGENT_PLUGIN_DIR)
    .toConstantValue(createHostPluginDir(hostCaps));
  container
    .bind(AGENT_WORKSPACE_DIRECTORIES)
    .toConstantValue(createHostWorkspaceDirectories(hostCaps));
  container
    .bind(AGENT_WORKTREE_SETTINGS)
    .toConstantValue(createHostWorktreeSettings(hostCaps));
  container
    .bind(AGENT_KNOWN_FOLDERS)
    .toConstantValue(createHostKnownFolders(hostCaps));
  container
    .bind(AGENT_POWER_MONITOR)
    .toConstantValue(createHostPowerMonitor(hostCaps));

  // agentRouter.resetAll ctx lookups — shell/sleep live in main.
  container.bind(SHELL_SERVICE).toConstantValue({
    destroyAll: () => {
      hostCaps.shell.destroyAll
        .mutate()
        .catch((error) =>
          logger.warn("shell.destroyAll forward failed", error),
        );
    },
  });
  container.bind(SLEEP_SERVICE).toConstantValue({
    cleanup: () => {
      hostCaps.sleep.cleanup
        .mutate()
        .catch((error) => logger.warn("sleep.cleanup forward failed", error));
    },
  });

  return container;
}
