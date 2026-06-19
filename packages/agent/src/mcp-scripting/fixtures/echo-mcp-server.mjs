// A minimal stdio MCP server used by the McpClientPool integration test. It
// exposes two tools and echoes an env var back, so the test can assert that
// stdio `env` (the credential path) reaches the server process.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "echo", version: "1.0.0" });

server.tool(
  "add",
  "Add two numbers",
  { a: z.number(), b: z.number() },
  async ({ a, b }) => ({
    content: [{ type: "text", text: JSON.stringify({ sum: a + b }) }],
  }),
);

server.tool(
  "whoami",
  "Return the ECHO_SECRET env var the server was launched with",
  {},
  async () => ({
    content: [{ type: "text", text: process.env.ECHO_SECRET ?? "(unset)" }],
  }),
);

await server.connect(new StdioServerTransport());
