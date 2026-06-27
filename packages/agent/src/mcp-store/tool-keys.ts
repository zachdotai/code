export type McpToolApprovalMap = Record<string, unknown>;

export interface McpToolInstallationRef {
  toolName: string;
}

export type McpToolInstallationMap = Record<string, McpToolInstallationRef>;

interface ParsedMcpToolKey {
  serverName: string;
  toolName: string;
}

function isAlphaNumeric(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function isWhitespace(char: string | undefined): boolean {
  return (
    char === " " ||
    char === "\t" ||
    char === "\n" ||
    char === "\r" ||
    char === "\f"
  );
}

export function sanitizeMcpServerName(name: string): string {
  let sanitized = "";
  for (const char of name) {
    sanitized +=
      isAlphaNumeric(char) || char === "_" || char === "-" ? char : "_";
  }
  return sanitized;
}

function serverIdentity(name: string): string {
  let identity = "";
  let previousWasUnderscore = false;

  for (const char of sanitizeMcpServerName(name)) {
    if (char === "_") {
      if (identity.length > 0 && !previousWasUnderscore) {
        identity += char;
      }
      previousWasUnderscore = true;
      continue;
    }

    identity += char.toLowerCase();
    previousWasUnderscore = false;
  }

  return identity.endsWith("_") ? identity.slice(0, -1) : identity;
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
  const prefix = "The agent wants to call";
  if (!title.startsWith(prefix) || !title.endsWith(")")) {
    return null;
  }

  let toolStart = prefix.length;
  if (!isWhitespace(title[toolStart])) {
    return null;
  }

  while (isWhitespace(title[toolStart])) {
    toolStart++;
  }

  const serverEnd = title.length - 1;
  for (let index = toolStart + 1; index < serverEnd; index++) {
    if (title[index] !== "(" || !isWhitespace(title[index - 1])) {
      continue;
    }

    const toolName = title.slice(toolStart, index).trimEnd();
    const serverName = title.slice(index + 1, serverEnd);
    if (toolName && serverName) {
      return { toolName, serverName };
    }
  }

  return null;
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
