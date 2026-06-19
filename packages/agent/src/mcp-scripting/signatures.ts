import type { McpToolDescriptor } from "./client-pool";

/** A server and the tools it exposes, ready to render as signatures. */
export interface ServerToolset {
  serverName: string;
  tools: McpToolDescriptor[];
}

/**
 * Renders the connected MCP toolset as a `.d.ts`-style hint so the model can
 * see exactly what `tools.<server>.<tool>(args)` calls are available and what
 * each argument is. Every call returns a Promise; the doc says so once at the
 * top rather than repeating `Promise<...>` on every line.
 */
export function renderToolsetSignatures(toolsets: ServerToolset[]): string {
  if (toolsets.length === 0) {
    return "// No external MCP servers are connected, so `tools` is empty.";
  }
  const blocks = toolsets.map(renderServerBlock);
  return [
    "// Each method is async — `await tools.<server>.<tool>(args)`.",
    "// Args are validated against the server's schema before the call runs.",
    "declare const tools: {",
    ...blocks,
    "}",
  ].join("\n");
}

function renderServerBlock(toolset: ServerToolset): string {
  const member = propertyKey(toolset.serverName);
  if (toolset.tools.length === 0) {
    return `  ${member}: {} // no tools advertised`;
  }
  const lines = toolset.tools.map((tool) => renderToolSignature(tool));
  return [`  ${member}: {`, ...lines, "  }"].join("\n");
}

function renderToolSignature(tool: McpToolDescriptor): string {
  const params = renderParams(tool.inputSchema);
  const doc = tool.description
    ? `    /** ${oneLine(tool.description)} */\n`
    : "";
  return `${doc}    ${propertyKey(tool.name)}(${params}): unknown`;
}

function renderParams(schema: McpToolDescriptor["inputSchema"]): string {
  const properties = isRecord(schema?.properties)
    ? schema.properties
    : undefined;
  if (!properties || Object.keys(properties).length === 0) {
    return "";
  }
  const required = new Set(
    Array.isArray(schema?.required)
      ? (schema.required as unknown[]).filter(
          (r): r is string => typeof r === "string",
        )
      : [],
  );
  const fields = Object.entries(properties).map(([name, raw]) => {
    const optional = required.has(name) ? "" : "?";
    return `${propertyKey(name)}${optional}: ${jsonSchemaToTs(raw)}`;
  });
  return `args: { ${fields.join("; ")} }`;
}

/** Best-effort JSON-Schema → TS type for a single field, kept shallow. */
function jsonSchemaToTs(raw: unknown): string {
  if (!isRecord(raw)) {
    return "unknown";
  }
  if (Array.isArray(raw.enum) && raw.enum.length > 0) {
    return raw.enum.map((v) => JSON.stringify(v)).join(" | ");
  }
  const type = raw.type;
  if (type === "array") {
    return `${jsonSchemaToTs(raw.items)}[]`;
  }
  if (type === "object" || isRecord(raw.properties)) {
    return "Record<string, unknown>";
  }
  if (type === "string") {
    return "string";
  }
  if (type === "number" || type === "integer") {
    return "number";
  }
  if (type === "boolean") {
    return "boolean";
  }
  if (Array.isArray(type)) {
    return (
      type.map((t) => jsonSchemaToTs({ type: t })).join(" | ") || "unknown"
    );
  }
  return "unknown";
}

/** A bare identifier when it's a valid one, else a quoted key. */
function propertyKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function oneLine(text: string): string {
  // Collapse whitespace and neutralize `*/` so a tool description can't close
  // the surrounding JSDoc block early and emit malformed TypeScript.
  return text.replace(/\s+/g, " ").trim().replace(/\*\//g, "* /");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
