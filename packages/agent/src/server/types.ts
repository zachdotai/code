import type { AddOnConfig } from "../add-ons/types";
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
  apiUrl: string;
  apiKey: string;
  projectId: number;
  jwtPublicKey: string; // RS256 public key for JWT verification
  eventIngestToken?: string;
  eventIngestStreamWindowMs?: number;
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
  /**
   * Add-on configuration sourced from `task.options.add_ons`. Forwarded
   * verbatim onto `_meta.addOns` of the cloud `newSession` call where the
   * adapter's add-on registry resolves it. Names not registered on the
   * sandbox-side `defaultAddOnRegistry` are skipped with a warning.
   */
  addOns?: AddOnConfig;
}
