import { fileURLToPath } from "node:url";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { McpClientPool } from "./client-pool";
import { buildToolsProxy } from "./proxy";
import { runScript } from "./runner";
import { listMcpToolsTool, runMcpScriptTool } from "./tools";

const ECHO_SERVER = fileURLToPath(
  new URL("./fixtures/echo-mcp-server.mjs", import.meta.url),
);

describe("McpClientPool (real stdio MCP server)", () => {
  let pool: McpClientPool | undefined;

  afterEach(async () => {
    await pool?.close();
    pool = undefined;
  });

  it("lists tools and calls them over a real stdio transport", async () => {
    pool = new McpClientPool({
      echo: { type: "stdio", command: process.execPath, args: [ECHO_SERVER] },
    });

    const tools = await pool.listTools("echo");
    expect(tools.map((t) => t.name).sort()).toEqual(["add", "whoami"]);

    const result = await pool.callTool("echo", "add", { a: 2, b: 3 });
    expect(result.isError).toBe(false);
    expect(result.value).toEqual({ sum: 5 });
  });

  it("inherits stdio env as the credential path", async () => {
    pool = new McpClientPool({
      echo: {
        type: "stdio",
        command: process.execPath,
        args: [ECHO_SERVER],
        env: { ECHO_SECRET: "s3cr3t-token" },
      },
    });

    const result = await pool.callTool("echo", "whoami", {});
    expect(result.value).toBe("s3cr3t-token");
  });

  it("drives the real server end-to-end through a script", async () => {
    pool = new McpClientPool({
      echo: { type: "stdio", command: process.execPath, args: [ECHO_SERVER] },
    });
    const tools = buildToolsProxy(pool, pool.serverNames());

    const { result, error } = await runScript({
      tools,
      script: `
        let total = 0
        for (let i = 1; i <= 3; i++) {
          const r = await tools.echo.add({ a: total, b: i })
          total = r.sum
        }
        return total
      `,
    });

    expect(error).toBeUndefined();
    expect(result).toBe(6);
  }, 15_000);

  it("excludes in-process sdk servers from serverNames", () => {
    pool = new McpClientPool({
      echo: { type: "stdio", command: process.execPath, args: [ECHO_SERVER] },
      // sdk servers have no dialable transport; cast to satisfy the union.
      inproc: { type: "sdk", name: "inproc" } as never,
    });
    expect(pool.serverNames()).toEqual(["echo"]);
  });
});

describe("scripting local tools (real stdio MCP server)", () => {
  const echoConfig: Record<string, McpServerConfig> = {
    echo: { type: "stdio", command: process.execPath, args: [ECHO_SERVER] },
  };

  it("run_mcp_script gates on having scriptable servers", () => {
    expect(runMcpScriptTool.isEnabled({ cwd: "/r" }, undefined)).toBe(false);
    expect(
      runMcpScriptTool.isEnabled(
        { cwd: "/r", scriptableMcpServers: echoConfig },
        undefined,
      ),
    ).toBe(true);
  });

  it("list_mcp_tools renders real signatures and notes unreachable servers", async () => {
    const result = await listMcpToolsTool.handler(
      {
        cwd: "/r",
        scriptableMcpServers: {
          ...echoConfig,
          broken: { type: "stdio", command: "definitely-not-a-real-binary" },
        },
      },
      {},
    );
    const text = result.content[0].text;
    expect(text).toContain("echo");
    expect(text).toContain("add(args: {");
    expect(text).toContain("Unreachable servers");
    expect(text).toContain("broken");
  }, 15_000);

  it("run_mcp_script executes against the real server end-to-end", async () => {
    const result = await runMcpScriptTool.handler(
      { cwd: "/r", scriptableMcpServers: echoConfig },
      { script: "return (await tools.echo.add({ a: 40, b: 2 })).sum" },
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('"result": 42');
  }, 15_000);
});
