// Narrow ports inverting AgentService's dependencies on core/host services so it
// can live in workspace-server without importing @posthog/core or apps/code.
// The host (apps/code) binds these to the concrete SleepService, McpAppsService,
// FsService bridge, AuthService, and scoped logger.
//
// Everything here is async and data-only so a host can also satisfy it from
// another process (the node-host utilityProcess proxies these back to main).

import type { RegisteredFolder } from "../folders/schemas";

export interface AgentScopedLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface AgentLogger {
  scope(scope: string): AgentScopedLogger;
}

export interface AgentSleepCoordinator {
  acquire(activityId: string): void;
  release(activityId: string): void;
}

export interface AgentMcpServerConnectionConfig {
  name: string;
  url: string;
  headers: Record<string, string>;
}

export interface AgentMcpApps {
  handleDiscovery(serverNames: string[]): Promise<void>;
  setServerConfigs(configs: AgentMcpServerConnectionConfig[]): void;
  notifyToolCancelled(toolKey: string, toolCallId: string): void;
  notifyToolInput(toolKey: string, toolCallId: string, args: unknown): void;
  notifyToolResult(
    toolKey: string,
    toolCallId: string,
    result: unknown,
    isError?: boolean,
  ): void;
  cleanup(): Promise<void>;
}

export interface AgentRepoFiles {
  readRepoFile(repoPath: string, filePath: string): Promise<string | null>;
  writeRepoFile(
    repoPath: string,
    filePath: string,
    content: string,
  ): Promise<void>;
}

/** The plugin directory handed to agent sessions (PosthogPluginService in main). */
export interface AgentPluginDir {
  getPluginPath(): Promise<string>;
}

/** Extra directories the user attached to a task's workspace (sqlite-backed in main). */
export interface AgentWorkspaceDirectories {
  getAdditionalDirectories(taskId: string): Promise<string[]>;
}

/** The configured worktree base location (electron-store-backed in main). */
export interface AgentWorktreeSettings {
  getWorktreeLocation(): Promise<string>;
}

/** The user's previously-registered local folders, for repo-less channel sessions. */
export interface AgentKnownFolders {
  getFolders(): Promise<RegisteredFolder[]>;
}

/** System-resume notifications (Electron powerMonitor in main). */
export interface AgentPowerMonitor {
  /** Register a resume handler; returns an unsubscribe. */
  onResume(handler: () => void): () => void;
}

type AgentFetchLike = (
  input: string | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface AgentAuth {
  getValidAccessToken(): Promise<{ accessToken: string; apiHost: string }>;
  refreshAccessToken(): Promise<{ accessToken: string; apiHost: string }>;
  authenticatedFetch(
    fetchImpl: AgentFetchLike,
    input: string | Request,
    init?: RequestInit,
  ): Promise<Response>;
}
