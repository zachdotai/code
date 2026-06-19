import { describe, expect, it } from "vitest";
import type { McpClientPool, McpToolDescriptor } from "./client-pool";
import { buildToolsProxy } from "./proxy";
import { runScript } from "./runner";
import { renderToolsetSignatures } from "./signatures";

/**
 * A fake pool standing in for {@link McpClientPool}: it records calls and serves
 * canned results, so the proxy/runner can be exercised without a real MCP
 * server. Only the methods the proxy uses are implemented.
 */
function fakePool(opts: {
  servers: Record<string, McpToolDescriptor[]>;
  call?: (
    server: string,
    tool: string,
    args: Record<string, unknown>,
  ) => unknown;
}): McpClientPool & { calls: Array<[string, string, unknown]> } {
  const calls: Array<[string, string, unknown]> = [];
  const pool = {
    calls,
    serverNames: () => Object.keys(opts.servers),
    listTools: async (server: string) => opts.servers[server] ?? [],
    callTool: async (
      server: string,
      tool: string,
      args: Record<string, unknown>,
    ) => {
      calls.push([server, tool, args]);
      const value = opts.call ? opts.call(server, tool, args) : null;
      const isError =
        typeof value === "object" &&
        value !== null &&
        (value as { __error?: boolean }).__error === true;
      return { value, content: [], isError };
    },
    close: async () => {},
  };
  return pool as unknown as McpClientPool & {
    calls: Array<[string, string, unknown]>;
  };
}

describe("mcp-scripting", () => {
  describe("buildToolsProxy", () => {
    it("forwards tools.<server>.<tool>(args) to the pool and returns the value", async () => {
      const pool = fakePool({
        servers: { linear: [] },
        call: (_s, tool, args) =>
          tool === "createIssue" ? { id: "ISS-1", ...args } : null,
      });
      const tools = buildToolsProxy(pool, pool.serverNames());

      const result = await tools.linear.createIssue({ title: "Bug" });

      expect(result).toEqual({ id: "ISS-1", title: "Bug" });
      expect(pool.calls).toEqual([["linear", "createIssue", { title: "Bug" }]]);
    });

    it("defaults args to {} when called without arguments", async () => {
      const pool = fakePool({ servers: { linear: [] }, call: () => "ok" });
      const tools = buildToolsProxy(pool, pool.serverNames());

      await tools.linear.listIssues();

      expect(pool.calls).toEqual([["linear", "listIssues", {}]]);
    });

    it("returns undefined for unknown servers", () => {
      const pool = fakePool({ servers: { linear: [] } });
      const tools = buildToolsProxy(pool, pool.serverNames());
      expect((tools as Record<string, unknown>).github).toBeUndefined();
      expect(Object.keys(tools)).toEqual(["linear"]);
    });

    it("rejects when a tool reports isError so scripts can try/catch", async () => {
      const pool = fakePool({
        servers: { linear: [] },
        call: () => ({ __error: true, message: "boom" }),
      });
      const tools = buildToolsProxy(pool, pool.serverNames());

      await expect(tools.linear.failing({})).rejects.toThrow(/boom/);
    });
  });

  describe("runScript", () => {
    it("runs a script, returns its value, and captures console output", async () => {
      const pool = fakePool({
        servers: { linear: [] },
        call: (_s, _t, args) => (args as { n: number }).n * 2,
      });
      const tools = buildToolsProxy(pool, pool.serverNames());

      const { result, logs, error } = await runScript({
        tools,
        script: `
          console.log("starting")
          const doubled = await tools.linear.double({ n: 21 })
          return { doubled }
        `,
      });

      expect(error).toBeUndefined();
      expect(result).toEqual({ doubled: 42 });
      expect(logs).toContain("starting");
    });

    it("supports looping and batching over results", async () => {
      const pool = fakePool({
        servers: { linear: [] },
        call: (_s, tool, args) => {
          if (tool === "listIssues") {
            return [
              { id: "A", done: false },
              { id: "B", done: true },
              { id: "C", done: false },
            ];
          }
          return { closed: (args as { id: string }).id };
        },
      });
      const tools = buildToolsProxy(pool, pool.serverNames());

      const { result, error } = await runScript({
        tools,
        script: `
          const issues = await tools.linear.listIssues({})
          const open = issues.filter((i) => !i.done)
          const closed = []
          for (const i of open) {
            const r = await tools.linear.closeIssue({ id: i.id })
            closed.push(r.closed)
          }
          return closed
        `,
      });

      expect(error).toBeUndefined();
      expect(result).toEqual(["A", "C"]);
      // 1 list + 2 closes
      expect(pool.calls).toHaveLength(3);
    });

    it("surfaces script errors as a message, not a throw", async () => {
      const pool = fakePool({ servers: { linear: [] } });
      const tools = buildToolsProxy(pool, pool.serverNames());

      const { result, error } = await runScript({
        tools,
        script: `throw new Error("explicit failure")`,
      });

      expect(result).toBeUndefined();
      expect(error).toMatch(/explicit failure/);
    });

    it("surfaces a tool error thrown inside the script", async () => {
      const pool = fakePool({
        servers: { linear: [] },
        call: () => ({ __error: true, message: "rate limited" }),
      });
      const tools = buildToolsProxy(pool, pool.serverNames());

      const { error } = await runScript({
        tools,
        script: `await tools.linear.create({})`,
      });

      expect(error).toMatch(/rate limited/);
    });

    it("enforces a wall-clock timeout", async () => {
      const pool = fakePool({ servers: {} });
      const tools = buildToolsProxy(pool, []);

      const { error } = await runScript({
        tools,
        timeoutMs: 50,
        script: `await new Promise((resolve) => setTimeout(resolve, 5000))`,
      });

      expect(error).toMatch(/timed out/i);
    });

    it("treats timeoutMs as one shared budget across sync and async phases", async () => {
      const pool = fakePool({ servers: {} });
      const tools = buildToolsProxy(pool, []);

      // A brief synchronous spin followed by an async wait that would, on its
      // own, fit inside timeoutMs — but combined must trip the single deadline.
      const start = Date.now();
      const { error } = await runScript({
        tools,
        timeoutMs: 200,
        script: `
          const until = Date.now() + 120;
          while (Date.now() < until) {}
          await new Promise((resolve) => setTimeout(resolve, 5000));
        `,
      });
      const elapsed = Date.now() - start;

      expect(error).toMatch(/timed out/i);
      // Single budget: total stays near timeoutMs, never approaching 2×.
      expect(elapsed).toBeLessThan(400);
    });

    describe("sandbox isolation", () => {
      const pool = fakePool({ servers: {} });
      const tools = buildToolsProxy(pool, []);

      it.each([
        ["require", `return typeof require`],
        ["process", `return typeof process`],
        ["global", `return typeof global`],
        ["globalThis.process", `return typeof globalThis.process`],
        ["Buffer", `return typeof Buffer`],
        ["fetch", `return typeof fetch`],
      ])("denies access to %s", async (_name, script) => {
        const { result, error } = await runScript({ tools, script });
        // Either the symbol is absent (typeof "undefined") or referencing it throws.
        if (error) {
          expect(error).toMatch(/is not defined|undefined/i);
        } else {
          expect(result).toBe("undefined");
        }
      });

      it("blocks dynamic code generation (new Function)", async () => {
        const { error } = await runScript({
          tools,
          script: `return new Function("return 1")()`,
        });
        expect(error).toBeTruthy();
      });

      it("blocks process access via constructor escape attempt", async () => {
        const { result, error } = await runScript({
          tools,
          script: `
            try {
              return (function(){}).constructor("return process")()
            } catch (e) {
              return "blocked: " + e.message
            }
          `,
        });
        // codeGeneration.strings:false makes the Function constructor throw.
        if (!error) {
          expect(String(result)).toMatch(/blocked/);
        } else {
          expect(error).toBeTruthy();
        }
      });
    });
  });

  describe("renderToolsetSignatures", () => {
    it("renders tools.<server>.<tool>(args) signatures from JSON schemas", () => {
      const text = renderToolsetSignatures([
        {
          serverName: "linear",
          tools: [
            {
              name: "createIssue",
              description: "Create an issue",
              inputSchema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  teamId: { type: "string" },
                  priority: { type: "number" },
                },
                required: ["title", "teamId"],
              },
            },
          ],
        },
      ]);

      expect(text).toContain("linear");
      expect(text).toContain("createIssue(args: {");
      expect(text).toContain("title: string");
      expect(text).toContain("teamId: string");
      expect(text).toContain("priority?: number");
      expect(text).toContain("Create an issue");
    });

    it("handles enums, arrays, and empty schemas", () => {
      const text = renderToolsetSignatures([
        {
          serverName: "x",
          tools: [
            {
              name: "noArgs",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "withEnum",
              inputSchema: {
                type: "object",
                properties: {
                  status: { enum: ["open", "closed"] },
                  tags: { type: "array", items: { type: "string" } },
                },
                required: ["status"],
              },
            },
          ],
        },
      ]);

      expect(text).toContain("noArgs()");
      expect(text).toContain(`status: "open" | "closed"`);
      expect(text).toContain("tags?: string[]");
    });

    it("reports the empty case", () => {
      expect(renderToolsetSignatures([])).toMatch(/No external MCP servers/);
    });

    it("neutralizes `*/` in a description so the JSDoc block stays valid", () => {
      const text = renderToolsetSignatures([
        {
          serverName: "math",
          tools: [
            {
              name: "divide",
              description: "Computes a*/b",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      ]);

      // The raw `*/` must not survive, or it would close the comment early.
      const jsdocLine = text
        .split("\n")
        .find((l) => l.includes("/**") && l.includes("Computes"));
      expect(jsdocLine).toBeDefined();
      expect(jsdocLine).toBe("    /** Computes a* /b */");
    });
  });
});
