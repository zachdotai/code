# MCP tools as scripts

Lets the agent write **one JavaScript script** that calls the connected MCP
tools as ordinary async functions, instead of orchestrating them one tool-call
at a time. The classic pain it removes: a server that needs 100 sequential calls
(list, then act per item) becomes a single script with a loop.

```js
const issues = await tools.linear.listIssues({ teamId })
const stale = issues.filter((i) => i.status === "backlog")
for (const i of stale) {
  await tools.linear.createComment({ issueId: i.id, body: "bump" })
}
return { bumped: stale.length }
```

Exposed to the model as two local tools (registered in
`../adapters/local-tools/index.ts`):

- **`list_mcp_tools`** — returns `.d.ts`-style signatures for every
  `tools.<server>.<tool>(args)` call available, generated from each tool's MCP
  input schema. Call it first to discover what to call.
- **`run_mcp_script`** — takes `{ script, timeoutMs? }`, runs the script with
  `tools` injected, returns `{ result, logs, error? }`.

## Pieces

| File | Responsibility |
| --- | --- |
| `client-pool.ts` | Opens/caches one MCP `Client` per server from the session's `McpServerConfig` map; `listTools` / `callTool`. |
| `proxy.ts` | Builds the lazy `tools.<server>.<tool>(args)` proxy that forwards to the pool. |
| `runner.ts` | Runs the script in a constrained `node:vm` context with a wall-clock timeout. |
| `signatures.ts` | Renders connected tools as TypeScript-style signatures. |
| `tools.ts` | The `run_mcp_script` / `list_mcp_tools` local-tool definitions. |

## Credential flow — no new auth path

The proxy dials the **exact same MCP server configs** the agent's own MCP tools
use, so authentication is inherited verbatim. The chain:

1. The ACP client sends MCP servers in the `newSession` params. `parseMcpServers`
   (`../adapters/claude/session/mcp-config.ts`) turns them into a
   `Record<string, McpServerConfig>` — **stdio** entries carry `env`, **http/sse**
   entries carry `headers`. This map is the single credential source.
2. Both adapters snapshot that map into `LocalToolCtx.scriptableMcpServers`:
   `claude-agent.ts` passes it *before* the in-process local-tools server is mixed
   in (so scripts never try to dial an in-process `sdk` server — those have no
   transport), and `codex-agent.ts` derives it from the same ACP `mcpServers` via
   `parseMcpServers`. The scripting tools self-disable when no external servers
   are present.
3. On a `run_mcp_script` / `list_mcp_tools` call, `McpClientPool` reads a config
   and constructs the matching MCP SDK transport:
   - `stdio` → `StdioClientTransport` with `command`/`args`/`env` (the session env
     is inherited too, so stdio servers keep ambient credentials).
   - `http` → `StreamableHTTPClientTransport` with `requestInit.headers`.
   - `sse` → `SSEClientTransport` with `requestInit.headers`.

There is no separate token store, no re-auth, and nothing the model can set: a
script can only reach servers the session was already authorized for, with the
same credentials those tools already had.

## Sandbox model

`runner.ts` executes the script in a `node:vm` context whose globals are an
explicit allowlist:

- **Granted:** `tools`, a captured `console`, and pure stateless helpers
  (`JSON`, `Math`, `Date`, `Array`/`Object`/`Map`/`Set`/…, `structuredClone`,
  `TextEncoder`/`TextDecoder`, `URL`/`URLSearchParams`, `setTimeout`/`clearTimeout`).
- **Denied:** `require`, `import`, `process`, `global`/`globalThis` ambient
  authority, `Buffer`, `fetch`, filesystem — so the **only** way out is `tools.*`.
- **No dynamic code:** the context is created with
  `codeGeneration: { strings: false, wasm: false }`, so `new Function(...)` /
  `eval` throw — closing the most common `vm` escape via the `Function`
  constructor.
- **Wall-clock timeout:** default 30s, capped at 120s. `node:vm` can't interrupt a
  pending Promise (e.g. a hung tool call), so the timeout *races* script
  completion to bound total time; the per-server MCP tool timeout still applies to
  each individual call.

`node:vm` is **not** a hard security boundary against hostile code sharing the
process — but here the script author is the same agent that already calls these
tools directly. The goal is to **remove ambient authority** (fs/net/env) and
funnel every side effect through the audited `tools` path, not to contain an
adversary. Cloud runs additionally execute the whole agent inside a sandbox,
which is the real isolation layer.

## Adopt vs build

Researched the "code mode for MCP" ecosystem (Cloudflare *Code Mode*,
`@utcp/code-mode` / `code-mode-mcp`, `mcpac`). They all run as a **separate MCP
server or standalone process** that connects to MCP clients via its own config
(or target Cloudflare `workerd` isolates), and several add a second abstraction
(UTCP) on top of MCP. None reuse an existing in-process `McpServerConfig` map
with already-resolved credentials — which is the entire integration we need.

Adopting one would mean standing up another process, re-plumbing auth into it,
and taking a heavier dependency (some MPL-2.0) for what is a ~5-file thin layer
over the MCP SDK `Client` we already depend on. **Decision: build.** The layer is
small, has no new runtime dependencies (only `@modelcontextprotocol/sdk` and
`zod`, both already present), and inherits auth for free.

## Tests

`mcp-scripting.test.ts` covers proxy generation, a script calling a tool,
looping/batching, timeout enforcement, error surfacing, signature rendering, and
sandbox-escape attempts (`require`/`process`/`global`/`Buffer`/`fetch`/`new
Function` denied). `client-pool.integration.test.ts` spins up a real stdio MCP
server (`fixtures/echo-mcp-server.mjs`) and drives it end-to-end through a
script, including asserting that stdio `env` reaches the server (the credential
path).
