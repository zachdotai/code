export type McpToolApprovalMap = Record<string, unknown>;

export interface McpToolInstallationRef {
  toolName: string;
}

export type McpToolInstallationMap = Record<string, McpToolInstallationRef>;

interface ParsedMcpToolKey {
  serverName: string;
  toolName: string;
}

export function sanitizeMcpServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function serverIdentity(name: string): string {
  return sanitizeMcpServerName(name)
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function buildMcpToolKey(serverName: string, toolName: string): string {
  return `mcp__${sanitizeMcpServerName(serverName)}__${toolName}`;
}

export function parseMcpToolKey(toolName: string): ParsedMcpToolKey | null {
  if (!toolName.startsWith("mcp__")) {
    return null;
  }

  const parts = toolName.split("__");
  if (parts.length < 3) {
    return null;
  }

  return {
    serverName: parts[1],
    toolName: parts.slice(2).join("__"),
  };
}

export function normalizeMcpToolKey(toolName: string): string {
  const parsed = parseMcpToolKey(toolName);
  return parsed
    ? buildMcpToolKey(parsed.serverName, parsed.toolName)
    : toolName;
}

function hasApproval(approvals: McpToolApprovalMap | undefined, key: string) {
  return Object.hasOwn(approvals ?? {}, key);
}

function approvalKeys(approvals: McpToolApprovalMap | undefined): string[] {
  return Object.keys(approvals ?? {});
}

function uniqueMatch(matches: string[]): string | null {
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : null;
}

export function resolveMcpStoreToolKeyFromParts(params: {
  serverName?: string | null;
  toolName: string;
  approvals?: McpToolApprovalMap;
  installations?: McpToolInstallationMap;
}): string | null {
  const { serverName, toolName, approvals, installations } = params;

  if (serverName) {
    const normalized = buildMcpToolKey(serverName, toolName);
    if (hasApproval(approvals, normalized)) {
      return normalized;
    }

    const wantedServer = serverIdentity(serverName);
    const matches = approvalKeys(approvals).filter((key) => {
      const parsed = parseMcpToolKey(key);
      return (
        parsed?.toolName === toolName &&
        serverIdentity(parsed.serverName) === wantedServer
      );
    });
    const match = uniqueMatch(matches);
    if (match) return match;
  }

  const installationMatches = Object.entries(installations ?? {})
    .filter(
      ([key, installation]) =>
        installation.toolName === toolName && hasApproval(approvals, key),
    )
    .map(([key]) => key);
  const installationMatch = uniqueMatch(installationMatches);
  if (installationMatch) return installationMatch;

  const approvalMatches = approvalKeys(approvals).filter(
    (key) => parseMcpToolKey(key)?.toolName === toolName,
  );
  return uniqueMatch(approvalMatches);
}

function parseApprovalTitle(title: string): {
  serverName: string;
  toolName: string;
} | null {
  const match = title.match(/^The agent wants to call\s+(.+?)\s+\((.+)\)$/);
  if (!match) {
    return null;
  }
  return { toolName: match[1], serverName: match[2] };
}

export function resolveMcpStoreToolKey(
  candidate: string | null | undefined,
  params: {
    approvals?: McpToolApprovalMap;
    installations?: McpToolInstallationMap;
  },
): string | null {
  if (!candidate) return null;

  const trimmed = candidate.trim();
  if (!trimmed) return null;

  if (hasApproval(params.approvals, trimmed)) {
    return trimmed;
  }

  const normalized = normalizeMcpToolKey(trimmed);
  if (normalized !== trimmed && hasApproval(params.approvals, normalized)) {
    return normalized;
  }

  const parsed = parseMcpToolKey(trimmed);
  if (parsed) {
    return resolveMcpStoreToolKeyFromParts({
      ...params,
      serverName: parsed.serverName,
      toolName: parsed.toolName,
    });
  }

  const titleParts = parseApprovalTitle(trimmed);
  if (titleParts) {
    return resolveMcpStoreToolKeyFromParts({
      ...params,
      serverName: titleParts.serverName,
      toolName: titleParts.toolName,
    });
  }

  return resolveMcpStoreToolKeyFromParts({
    ...params,
    toolName: trimmed,
  });
}
