import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type {
  NativeAgentToolContext,
  NativeAgentToolDefinition,
  NativeAgentToolParameter,
} from "../../../types";

export const NATIVE_TOOLS_SERVER_NAME = "posthog_code_native_tools";

function parametersToZodShape(
  parameters: Record<string, NativeAgentToolParameter> | undefined,
): z.ZodRawShape {
  if (!parameters) return {};

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, parameter] of Object.entries(parameters)) {
    let schema: z.ZodTypeAny;
    if (parameter.type === "number") schema = z.number();
    else if (parameter.type === "boolean") schema = z.boolean();
    else schema = z.string();

    if (parameter.description) schema = schema.describe(parameter.description);
    shape[name] = parameter.optional ? schema.optional() : schema;
  }

  return shape;
}

export function createNativeToolsMcpServer(
  tools: NativeAgentToolDefinition[] | undefined,
  context: NativeAgentToolContext,
): McpSdkServerConfigWithInstance | undefined {
  if (!tools?.length) return undefined;

  return createSdkMcpServer({
    name: NATIVE_TOOLS_SERVER_NAME,
    version: "1.0.0",
    tools: tools.map((nativeTool) =>
      tool(
        nativeTool.name,
        nativeTool.description,
        parametersToZodShape(nativeTool.parameters),
        async (args) => {
          const text = await nativeTool.handler(args, context);
          return { content: [{ type: "text" as const, text }] };
        },
        { alwaysLoad: true },
      ),
    ),
  });
}
