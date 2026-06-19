import { z } from "zod";
import {
  defineLocalTool,
  type LocalTool,
  type LocalToolCtx,
  type LocalToolResult,
} from "../adapters/local-tools/registry";
import { McpClientPool, scriptableServerNames } from "./client-pool";
import { buildToolsProxy } from "./proxy";
import { runScript } from "./runner";
import { renderToolsetSignatures, type ServerToolset } from "./signatures";

const RUN_MCP_SCRIPT_DESCRIPTION = `Run one JavaScript script that calls the connected MCP tools as async functions, so you can orchestrate many tool calls with normal control flow (loops, filtering, batching) in a single step instead of one tool call at a time.

Inside the script, every connected MCP server is exposed as \`tools.<server>.<tool>(args)\` and returns a Promise of the tool's parsed result:

  const issues = await tools.linear.listIssues({ teamId })
  const stale = issues.filter((i) => i.status === "backlog")
  for (const i of stale) {
    await tools.linear.createComment({ issueId: i.id, body: "bump" })
  }
  return { closed: stale.length }

Rules:
- Call \`list_mcp_tools\` first to see which \`tools.*\` calls exist and their argument schemas.
- The script body runs as an async function: use \`await\` freely and \`return\` the value you want back.
- A tool that errors throws — wrap calls in try/catch if you want to continue.
- Loops and batching over results are encouraged; that's the whole point.
- Only \`tools\`, \`console\`, JSON/Math/Date and similar pure helpers are available — no filesystem, network, \`require\`, or \`process\`. Reach the outside world only through \`tools.*\`.
- The return value and any \`console.log\` output are sent back to you.`;

const LIST_MCP_TOOLS_DESCRIPTION = `List the MCP tools available to \`run_mcp_script\`, rendered as TypeScript-style signatures (\`tools.<server>.<tool>(args)\`) with argument schemas. Call this before writing a script so you know what to call.`;

export const runMcpScriptTool: LocalTool = defineLocalTool({
  name: "run_mcp_script",
  description: RUN_MCP_SCRIPT_DESCRIPTION,
  schema: {
    script: z
      .string()
      .describe(
        "JavaScript to run. Runs as an async function body; use await and return.",
      ),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(120_000)
      .optional()
      .describe("Wall-clock budget in ms (default 30000, max 120000)."),
  },
  alwaysLoad: true,
  isEnabled: (ctx) => hasScriptableServers(ctx),
  handler: async (ctx, args): Promise<LocalToolResult> => {
    const configs = ctx.scriptableMcpServers ?? {};
    const pool = new McpClientPool(configs);
    try {
      const serverNames = pool.serverNames();
      const tools = buildToolsProxy(pool, serverNames);
      const { result, logs, error } = await runScript({
        script: args.script as string,
        tools,
        timeoutMs: args.timeoutMs as number | undefined,
      });
      return toToolResult({ result, logs, error });
    } finally {
      await pool.close();
    }
  },
});

export const listMcpToolsTool: LocalTool = defineLocalTool({
  name: "list_mcp_tools",
  description: LIST_MCP_TOOLS_DESCRIPTION,
  schema: {},
  alwaysLoad: true,
  isEnabled: (ctx) => hasScriptableServers(ctx),
  handler: async (ctx): Promise<LocalToolResult> => {
    const configs = ctx.scriptableMcpServers ?? {};
    const pool = new McpClientPool(configs);
    try {
      const { toolsets, failed } = await collectToolsets(pool);
      const signatures = renderToolsetSignatures(toolsets);
      // Tell the agent about servers that wouldn't connect rather than silently
      // dropping them — otherwise an expected server just looks absent.
      const text =
        failed.length > 0
          ? `${signatures}\n\n// Unreachable servers (failed to connect): ${failed.join(", ")}`
          : signatures;
      return { content: [{ type: "text", text }] };
    } finally {
      await pool.close();
    }
  },
});

function hasScriptableServers(ctx: LocalToolCtx): boolean {
  const configs = ctx.scriptableMcpServers;
  return configs ? scriptableServerNames(configs).length > 0 : false;
}

async function collectToolsets(
  pool: McpClientPool,
): Promise<{ toolsets: ServerToolset[]; failed: string[] }> {
  const names = pool.serverNames();
  const settled = await Promise.allSettled(
    names.map(async (serverName) => ({
      serverName,
      tools: await pool.listTools(serverName),
    })),
  );
  // One failing server shouldn't fail the whole listing; report it instead.
  const toolsets: ServerToolset[] = [];
  const failed: string[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      toolsets.push(result.value);
    } else {
      failed.push(names[i]);
    }
  });
  return { toolsets, failed };
}

function toToolResult(payload: {
  result: unknown;
  logs: string[];
  error?: string;
}): LocalToolResult {
  const text = JSON.stringify(payload, null, 2);
  return {
    content: [{ type: "text", text }],
    ...(payload.error ? { isError: true as const } : {}),
  };
}
