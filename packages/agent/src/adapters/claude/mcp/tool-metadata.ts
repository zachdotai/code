import type { McpServerStatus, Query } from "@anthropic-ai/claude-agent-sdk";
import {
  buildMcpToolKey,
  normalizeMcpToolKey,
  parseMcpToolKey,
  resolveMcpStoreToolKey,
  sanitizeMcpServerName,
} from "../../../mcp-store/tool-keys";
import { Logger } from "../../../utils/logger";

export type McpToolApprovalState = "approved" | "needs_approval" | "do_not_use";

/** Maps MCP tool keys (e.g. `mcp__server__tool`) to their backend approval state. */
export type McpToolApprovals = Record<string, McpToolApprovalState>;

export interface McpToolMetadata {
  readOnly: boolean;
  name: string;
  serverName?: string;
  description?: string;
  approvalState?: McpToolApprovalState;
}

const mcpToolMetadataCache: Map<string, McpToolMetadata> = new Map();

// Per-tool approval state lives in its own store, keyed by normalized tool key.
// It must outlive the metadata cache: `clearMcpToolMetadataCache()` runs on
// every MCP server refresh/reconnect, and approval state is session config
// (set once from the start payload), not volatile per-connection metadata.
// Keeping them separate means a reconnect can't silently drop approvals and
// let a needs_approval tool slip through the gate.
const mcpToolApprovalCache: Map<string, McpToolApprovalState> = new Map();

const PENDING_RETRY_INTERVAL_MS = 1_000;
const PENDING_MAX_RETRIES = 10;

export { sanitizeMcpServerName };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchMcpToolMetadata(
  q: Query,
  logger: Logger = new Logger({ debug: false, prefix: "[McpToolMetadata]" }),
): Promise<void> {
  let retries = 0;

  while (retries <= PENDING_MAX_RETRIES) {
    let statuses: McpServerStatus[];
    try {
      statuses = await q.mcpServerStatus();
    } catch (error) {
      logger.error("Failed to fetch MCP server status", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const pendingServers = statuses.filter((s) => s.status === "pending");

    for (const server of statuses) {
      if (server.status !== "connected" || !server.tools) {
        continue;
      }

      let readOnlyCount = 0;
      for (const tool of server.tools) {
        const toolKey = buildMcpToolKey(server.name, tool.name);
        const readOnly = tool.annotations?.readOnly === true;

        const existing = mcpToolMetadataCache.get(toolKey);
        mcpToolMetadataCache.set(toolKey, {
          readOnly,
          name: tool.name,
          serverName: server.name,
          description: tool.description,
          approvalState:
            mcpToolApprovalCache.get(toolKey) ?? existing?.approvalState,
        });
        if (readOnly) readOnlyCount++;
      }

      logger.info("Fetched MCP tool metadata", {
        serverName: server.name,
        toolCount: server.tools.length,
        readOnlyCount,
      });
    }

    if (pendingServers.length === 0) {
      return;
    }

    retries++;
    if (retries > PENDING_MAX_RETRIES) {
      logger.warn("Gave up waiting for pending MCP servers", {
        pendingServers: pendingServers.map((s) => s.name),
      });
      return;
    }

    logger.info("Waiting for pending MCP servers", {
      pendingServers: pendingServers.map((s) => s.name),
      retry: retries,
    });
    await delay(PENDING_RETRY_INTERVAL_MS);
  }
}

export function getMcpToolMetadata(
  toolName: string,
): McpToolMetadata | undefined {
  const key = getMcpToolMetadataKey(toolName);
  return key ? mcpToolMetadataCache.get(key) : undefined;
}

export function getMcpToolMetadataKey(toolName: string): string | undefined {
  const resolvedKey = resolveMcpStoreToolKey(toolName, {
    approvals: Object.fromEntries(
      [...mcpToolMetadataCache.keys()].map((key) => [key, true]),
    ),
  });
  const normalizedToolName = normalizeMcpToolKey(toolName);
  if (mcpToolMetadataCache.has(toolName)) return toolName;
  if (mcpToolMetadataCache.has(normalizedToolName)) return normalizedToolName;
  return resolvedKey ?? undefined;
}

export function isMcpToolReadOnly(toolName: string): boolean {
  const metadata = getMcpToolMetadata(toolName);
  return metadata?.readOnly === true;
}

export function getConnectedMcpServerNames(): string[] {
  const names = new Set<string>();
  for (const key of mcpToolMetadataCache.keys()) {
    const parts = key.split("__");
    if (parts.length >= 3) names.add(parts[1]);
  }
  return [...names];
}

/** Snapshot of every tool currently in the metadata cache. Used by the
 *  context-breakdown estimator to size the MCP category. */
export function getCachedMcpTools(): McpToolMetadata[] {
  return [...mcpToolMetadataCache.values()];
}

export function getMcpToolApprovalState(
  toolName: string,
): McpToolApprovalState | undefined {
  if (mcpToolApprovalCache.size === 0) {
    return undefined;
  }
  // Direct/normalized hit first, then resolve server-name or title variants
  // against the known approval keys. Reads the approval store (not the
  // metadata cache) so it survives MCP metadata refreshes.
  const direct =
    mcpToolApprovalCache.get(toolName) ??
    mcpToolApprovalCache.get(normalizeMcpToolKey(toolName));
  if (direct) {
    return direct;
  }
  const resolvedKey = resolveMcpStoreToolKey(toolName, {
    approvals: Object.fromEntries(
      [...mcpToolApprovalCache.keys()].map((key) => [key, true]),
    ),
  });
  return resolvedKey ? mcpToolApprovalCache.get(resolvedKey) : undefined;
}

export function setMcpToolApprovalStates(approvals: McpToolApprovals): void {
  for (const [toolKey, approvalState] of Object.entries(approvals)) {
    const normalizedToolKey = normalizeMcpToolKey(toolKey);
    mcpToolApprovalCache.set(normalizedToolKey, approvalState);
    // Mirror onto the metadata cache entry when present so UI/debug reads stay
    // consistent; the approval store above remains the source of truth.
    const existing = mcpToolMetadataCache.get(normalizedToolKey);
    if (existing) {
      existing.approvalState = approvalState;
    } else {
      const parsed = parseMcpToolKey(normalizedToolKey);
      mcpToolMetadataCache.set(normalizedToolKey, {
        readOnly: false,
        name: parsed?.toolName ?? normalizedToolKey,
        serverName: parsed?.serverName,
        approvalState,
      });
    }
  }
}

export function clearMcpToolMetadataCache(): void {
  mcpToolMetadataCache.clear();
}

/** Reset per-tool approval state. Approvals survive metadata refreshes, so
 *  this is only for session teardown and tests — not the per-refresh clear. */
export function clearMcpToolApprovalCache(): void {
  mcpToolApprovalCache.clear();
}
