import type { McpClientPool } from "./client-pool";

/** The `tools` object injected into a script: `tools.<server>.<tool>(args)`. */
export type ToolsProxy = Record<
  string,
  Record<string, (args?: Record<string, unknown>) => Promise<unknown>>
>;

/**
 * Builds the `tools` proxy a script sees. Each `tools.<server>.<tool>(args)`
 * forwards to the live MCP client via the pool and resolves to the call's
 * parsed value (`structuredContent` when present, else parsed text). A tool
 * that returns `isError` rejects, so scripts can use ordinary try/catch.
 *
 * Access is lazy and name-driven: we don't pre-enumerate tools, so a script can
 * call any tool the server actually exposes. Unknown servers surface as
 * `undefined`, matching plain object access (`tools.nope` is `undefined`).
 */
export function buildToolsProxy(
  pool: McpClientPool,
  serverNames: readonly string[],
): ToolsProxy {
  const known = new Set(serverNames);
  const serverCache = new Map<
    string,
    Record<string, (args?: Record<string, unknown>) => Promise<unknown>>
  >();

  return new Proxy({} as ToolsProxy, {
    get(_target, prop): unknown {
      if (typeof prop !== "string" || !known.has(prop)) {
        return undefined;
      }
      const cached = serverCache.get(prop);
      if (cached) {
        return cached;
      }
      const serverProxy = buildServerProxy(pool, prop);
      serverCache.set(prop, serverProxy);
      return serverProxy;
    },
    has(_target, prop): boolean {
      return typeof prop === "string" && known.has(prop);
    },
    ownKeys(): string[] {
      return [...known];
    },
    getOwnPropertyDescriptor(_target, prop): PropertyDescriptor | undefined {
      if (typeof prop === "string" && known.has(prop)) {
        return { enumerable: true, configurable: true };
      }
      return undefined;
    },
  });
}

function buildServerProxy(
  pool: McpClientPool,
  serverName: string,
): Record<string, (args?: Record<string, unknown>) => Promise<unknown>> {
  const toolCache = new Map<
    string,
    (args?: Record<string, unknown>) => Promise<unknown>
  >();

  return new Proxy(
    {} as Record<string, (args?: Record<string, unknown>) => Promise<unknown>>,
    {
      get(_target, prop): unknown {
        if (typeof prop !== "string") {
          return undefined;
        }
        const cached = toolCache.get(prop);
        if (cached) {
          return cached;
        }
        const fn = async (
          args: Record<string, unknown> = {},
        ): Promise<unknown> => {
          const result = await pool.callTool(serverName, prop, args);
          if (result.isError) {
            throw new Error(
              `tools.${serverName}.${prop} failed: ${stringifyError(result.value)}`,
            );
          }
          return result.value;
        };
        toolCache.set(prop, fn);
        return fn;
      },
    },
  );
}

function stringifyError(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
