import type { AgentMode } from "../types";
import type { RemoteMcpServer } from "./schemas";

export interface ClaudeCodeConfig {
  systemPrompt?:
    | string
    | { type: "preset"; preset: "claude_code"; append?: string };
  plugins?: { type: "local"; path: string }[];
}

export interface AgentServerConfig {
  port: number;
  repositoryPath?: string;
  repoReadyFile?: string;
  apiUrl: string;
  apiKey: string;
  projectId: number;
  jwtPublicKey: string; // RS256 public key for JWT verification
  eventIngestToken?: string;
  // Base URL for the event-ingest POST only; falls back to apiUrl when unset.
  eventIngestBaseUrl?: string;
  eventIngestStreamWindowMs?: number;
  eventIngestKeepStreamOpen?: boolean;
  mode: AgentMode;
  taskId: string;
  runId: string;
  createPr?: boolean;
  version?: string;
  mcpServers?: RemoteMcpServer[];
  baseBranch?: string;
  claudeCode?: ClaudeCodeConfig;
  allowedDomains?: string[];
  runtimeAdapter?: "claude" | "codex";
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  otelLogs?: AgentServerOtelLogsConfig;
}

/**
 * OTEL logs export config for the cloud agent server. When present, the server
 * ships its logs to PostHog Logs via OTLP HTTP. Injected by the sandbox
 * environment; absent in local/dev runs, where export stays disabled.
 */
export interface AgentServerOtelLogsConfig {
  /** PostHog logs ingest host, e.g. "https://us.i.posthog.com" */
  host: string;
  /** Ingest-capable API key for the logs endpoint */
  apiKey: string;
  /** Override the logs endpoint path (default: /i/v1/logs) */
  logsPath?: string;
}
