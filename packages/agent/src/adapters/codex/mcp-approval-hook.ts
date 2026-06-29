import http from "node:http";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BRIDGE_TOKEN_BYTES = 32;
const DEFAULT_HOOK_TIMEOUT_SECONDS = 600;

export const CODEX_MCP_APPROVAL_HOOK_ENV = {
  bridgeUrl: "POSTHOG_CODEX_MCP_APPROVAL_BRIDGE_URL",
  bridgeToken: "POSTHOG_CODEX_MCP_APPROVAL_BRIDGE_TOKEN",
} as const;

export interface CodexMcpApprovalHookEnv {
  bridgeUrl: string;
  bridgeToken: string;
}

export interface CodexMcpApprovalHookInput {
  hookEventName: "PreToolUse" | "PostToolUse";
  toolName: string;
  toolUseId?: string;
  toolInput?: unknown;
  toolResponse?: unknown;
  turnId?: string;
  sessionId?: string;
  raw: Record<string, unknown>;
}

export type CodexMcpApprovalHookDecision =
  | { action: "allow" }
  | { action: "deny"; message: string };

export interface CodexMcpApprovalHookHandler {
  preToolUse(
    input: CodexMcpApprovalHookInput,
  ): Promise<CodexMcpApprovalHookDecision>;
  postToolUse(input: CodexMcpApprovalHookInput): Promise<void>;
}

interface HookLogger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
}

function toHookInput(raw: unknown): CodexMcpApprovalHookInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const hookEventName = record.hook_event_name;
  const toolName = record.tool_name;
  if (
    (hookEventName !== "PreToolUse" && hookEventName !== "PostToolUse") ||
    typeof toolName !== "string"
  ) {
    return null;
  }

  return {
    hookEventName,
    toolName,
    toolUseId:
      typeof record.tool_use_id === "string" ? record.tool_use_id : undefined,
    toolInput: record.tool_input,
    toolResponse: record.tool_response,
    turnId: typeof record.turn_id === "string" ? record.turn_id : undefined,
    sessionId:
      typeof record.session_id === "string" ? record.session_id : undefined,
    raw: record,
  };
}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function writeJson(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function createBridgeToken(): string {
  return randomBytes(BRIDGE_TOKEN_BYTES).toString("base64url");
}

export class CodexMcpApprovalHookBridge {
  private server: http.Server | null = null;
  private port: number | null = null;
  private readonly token = createBridgeToken();

  constructor(
    private readonly handler: CodexMcpApprovalHookHandler,
    private readonly logger: HookLogger,
  ) {}

  async start(): Promise<CodexMcpApprovalHookEnv> {
    if (this.server && this.port) {
      return {
        bridgeUrl: `http://127.0.0.1:${this.port}`,
        bridgeToken: this.token,
      };
    }

    const server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        this.logger.error("Codex MCP approval hook bridge error", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!res.headersSent) {
          writeJson(res, 500, {
            action: "deny",
            message: "MCP approval hook bridge failed.",
          });
        } else {
          res.end();
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Failed to start Codex MCP approval hook bridge"));
          return;
        }
        this.server = server;
        this.port = address.port;
        this.logger.info("Codex MCP approval hook bridge started", {
          port: this.port,
        });
        resolve();
      });
      server.on("error", reject);
    });

    return {
      bridgeUrl: `http://127.0.0.1:${this.port}`,
      bridgeToken: this.token,
    };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    this.server = null;
    this.port = null;
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    const authorization = req.headers.authorization ?? "";
    if (authorization !== `Bearer ${this.token}`) {
      writeJson(res, 401, { error: "unauthorized" });
      return;
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const rawBody = await readRequestBody(req);
    let parsed: unknown;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      writeJson(res, 400, {
        action: "deny",
        message: "Invalid Codex hook JSON.",
      });
      return;
    }
    const input = toHookInput(parsed);
    if (!input) {
      writeJson(res, 400, {
        action: "deny",
        message: "Invalid Codex hook input.",
      });
      return;
    }

    if (url.pathname === "/pre-tool-use") {
      const decision = await this.handler.preToolUse(input);
      writeJson(res, 200, decision);
      return;
    }

    if (url.pathname === "/post-tool-use") {
      await this.handler.postToolUse(input);
      writeJson(res, 200, { action: "allow" });
      return;
    }

    writeJson(res, 404, { error: "not_found" });
  }
}

function quoteCommandArg(value: string): string {
  if (process.platform === "win32") {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildHookScript(): string {
  return `#!/usr/bin/env node
const BRIDGE_URL_ENV = ${JSON.stringify(CODEX_MCP_APPROVAL_HOOK_ENV.bridgeUrl)};
const BRIDGE_TOKEN_ENV = ${JSON.stringify(CODEX_MCP_APPROVAL_HOOK_ENV.bridgeToken)};

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function denyPreToolUse(message) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: message,
    },
  }));
}

async function callBridge(path, input) {
  const bridgeUrl = process.env[BRIDGE_URL_ENV];
  const bridgeToken = process.env[BRIDGE_TOKEN_ENV];
  if (!bridgeUrl || !bridgeToken) {
    throw new Error("Codex MCP approval hook bridge is not configured.");
  }

  const response = await fetch(new URL(path, bridgeUrl), {
    method: "POST",
    headers: {
      "authorization": \`Bearer \${bridgeToken}\`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(typeof body.message === "string" ? body.message : "Codex MCP approval hook bridge rejected the request.");
  }
  return body;
}

async function main() {
  const raw = await readStdin();
  const input = raw ? JSON.parse(raw) : {};
  const event = input.hook_event_name;
  if (event !== "PreToolUse" && event !== "PostToolUse") {
    return;
  }

  try {
    const body = await callBridge(
      event === "PostToolUse" ? "/post-tool-use" : "/pre-tool-use",
      input,
    );
    if (event === "PreToolUse" && body.action === "deny") {
      denyPreToolUse(typeof body.message === "string" ? body.message : "MCP tool call was denied.");
    }
  } catch (error) {
    if (event === "PreToolUse") {
      denyPreToolUse(error instanceof Error ? error.message : String(error));
    }
  }
}

main().catch((error) => {
  denyPreToolUse(error instanceof Error ? error.message : String(error));
});
`;
}

export async function installCodexMcpApprovalHook(options: {
  codexHome: string;
  runtimeCommand: string;
  timeoutSeconds?: number;
}): Promise<void> {
  const hooksDir = join(options.codexHome, "hooks");
  await mkdir(hooksDir, { recursive: true });

  const scriptPath = join(hooksDir, "posthog-mcp-approval-hook.js");
  await writeFile(scriptPath, buildHookScript(), { mode: 0o700 });
  await chmod(scriptPath, 0o700);

  const command = `${quoteCommandArg(options.runtimeCommand)} ${quoteCommandArg(scriptPath)}`;
  const hookConfig = {
    hooks: {
      PreToolUse: [
        {
          matcher: "^mcp__.*",
          hooks: [
            {
              type: "command",
              command,
              timeout: options.timeoutSeconds ?? DEFAULT_HOOK_TIMEOUT_SECONDS,
              statusMessage: "Checking MCP tool approval",
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "^mcp__.*",
          hooks: [
            {
              type: "command",
              command,
              timeout: options.timeoutSeconds ?? DEFAULT_HOOK_TIMEOUT_SECONDS,
            },
          ],
        },
      ],
    },
  };

  await writeFile(
    join(options.codexHome, "hooks.json"),
    `${JSON.stringify(hookConfig, null, 2)}\n`,
  );
}
