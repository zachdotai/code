import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Logger } from "../utils/logger";

/** A tool as advertised by a connected MCP server. */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  /** The tool's JSON Schema for arguments (MCP `inputSchema`). */
  inputSchema?: Record<string, unknown>;
}

/** Result of a single MCP tool call, normalized for scripts. */
export interface McpCallResult {
  /** Structured payload when the server returns `structuredContent`, else the
   *  text blocks joined (JSON-parsed when they look like JSON). */
  value: unknown;
  /** Raw `content` blocks the server returned. */
  content: unknown[];
  isError: boolean;
}

/**
 * Opens and caches one MCP `Client` per configured server, reusing the
 * session's `McpServerConfig` map so authentication is inherited verbatim:
 * stdio servers carry credentials in `env`, http/sse servers in `headers`.
 * There is no separate auth path — a script call dials the exact transport the
 * agent's own MCP tools use.
 *
 * Connections are established lazily on first use of a server and torn down by
 * {@link close}. A pool is meant to live for the duration of one script run.
 */
export class McpClientPool {
  private readonly configs: Record<string, McpServerConfig>;
  private readonly logger?: Logger;
  private readonly clients = new Map<string, Promise<Client>>();

  constructor(configs: Record<string, McpServerConfig>, logger?: Logger) {
    this.configs = configs;
    this.logger = logger;
  }

  /** Server names this pool can dial (in-process `sdk` servers excluded). */
  serverNames(): string[] {
    return scriptableServerNames(this.configs);
  }

  /** Lists the tools a server advertises. Connects on first use. */
  async listTools(serverName: string): Promise<McpToolDescriptor[]> {
    const client = await this.getClient(serverName);
    const { tools } = await client.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }));
  }

  /** Calls a tool on a server, returning a normalized result. */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult> {
    const client = await this.getClient(serverName);
    const raw = await client.callTool({ name: toolName, arguments: args });
    const content = Array.isArray(raw.content) ? raw.content : [];
    return {
      value: extractValue(raw.structuredContent, content),
      content,
      isError: raw.isError === true,
    };
  }

  /** Disconnects every open client. Safe to call more than once. */
  async close(): Promise<void> {
    const pending = [...this.clients.values()];
    this.clients.clear();
    await Promise.allSettled(
      pending.map(async (p) => {
        try {
          const client = await p;
          await client.close();
        } catch (err) {
          this.logger?.debug("Error closing MCP client", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }

  private getClient(serverName: string): Promise<Client> {
    const existing = this.clients.get(serverName);
    if (existing) {
      return existing;
    }
    const connecting = this.connect(serverName);
    this.clients.set(serverName, connecting);
    // Don't cache a rejected connection — let the next call retry.
    connecting.catch(() => this.clients.delete(serverName));
    return connecting;
  }

  private async connect(serverName: string): Promise<Client> {
    const config = this.configs[serverName];
    if (!config) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }
    const transport = this.createTransport(serverName, config);
    const client = new Client({
      name: "posthog-mcp-scripting",
      version: "1.0.0",
    });
    await client.connect(transport);
    return client;
  }

  private createTransport(
    serverName: string,
    config: McpServerConfig,
  ): Transport {
    const type = transportableType(config);
    if (type === "stdio") {
      const stdio = config as {
        command: string;
        args?: string[];
        env?: Record<string, string>;
      };
      return new StdioClientTransport({
        command: stdio.command,
        args: stdio.args,
        // Inherit the session env so stdio servers keep their credentials.
        env: { ...filterUndefined(process.env), ...(stdio.env ?? {}) },
      });
    }
    if (type === "http" || type === "sse") {
      const remote = config as {
        url: string;
        headers?: Record<string, string>;
      };
      const url = new URL(remote.url);
      const opts = remote.headers
        ? { requestInit: { headers: remote.headers } }
        : undefined;
      return type === "http"
        ? new StreamableHTTPClientTransport(url, opts)
        : new SSEClientTransport(url, opts);
    }
    throw new Error(
      `MCP server "${serverName}" is in-process (sdk) and cannot be scripted`,
    );
  }
}

/** The dialable transport for a config, or `undefined` for in-process `sdk`. */
function transportableType(
  config: McpServerConfig,
): "stdio" | "http" | "sse" | undefined {
  if (!("type" in config) || config.type === "stdio") {
    return "stdio";
  }
  if (config.type === "http") {
    return "http";
  }
  if (config.type === "sse") {
    return "sse";
  }
  return undefined; // sdk (in-process) — no dialable transport
}

/**
 * Names of servers a script can dial — every config except in-process `sdk`
 * ones. Lets the scripting tools gate themselves without opening a pool.
 */
export function scriptableServerNames(
  configs: Record<string, McpServerConfig>,
): string[] {
  return Object.entries(configs)
    .filter(([, cfg]) => transportableType(cfg) !== undefined)
    .map(([name]) => name);
}

function filterUndefined(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function extractValue(structuredContent: unknown, content: unknown[]): unknown {
  if (structuredContent !== undefined) {
    return structuredContent;
  }
  const texts = content
    .filter(
      (c): c is { type: "text"; text: string } =>
        typeof c === "object" &&
        c !== null &&
        (c as { type?: unknown }).type === "text" &&
        typeof (c as { text?: unknown }).text === "string",
    )
    .map((c) => c.text);
  if (texts.length === 0) {
    return content;
  }
  const joined = texts.join("\n");
  try {
    return JSON.parse(joined);
  } catch {
    return joined;
  }
}
