import { DEFAULT_GATEWAY_MODEL } from "@posthog/agent/gateway-models";
import { z } from "zod";

export const llmMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

export type LlmMessage = z.infer<typeof llmMessageSchema>;

export const llmGatewayEffortLevel = z.enum(["low", "medium", "high", "max"]);
export type LlmGatewayEffortLevel = z.infer<typeof llmGatewayEffortLevel>;

export const promptInput = z.object({
  system: z.string().optional(),
  messages: z.array(llmMessageSchema),
  maxTokens: z.number().optional(),
  model: z.string().default(DEFAULT_GATEWAY_MODEL),
  betas: z.array(z.string().min(1)).optional(),
  effort: llmGatewayEffortLevel.optional(),
});

export type PromptInput = z.infer<typeof promptInput>;

export const promptOutput = z.object({
  content: z.string(),
  model: z.string(),
  stopReason: z.string().nullable(),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
  }),
});

export type PromptOutput = z.infer<typeof promptOutput>;

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type AnthropicToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "tool"; name: string };

export interface AnthropicMessagesRequest {
  model: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  max_tokens?: number;
  system?: string;
  stream?: boolean;
  output_config?: {
    effort?: LlmGatewayEffortLevel;
  };
  tools?: AnthropicToolDefinition[];
  tool_choice?: AnthropicToolChoice;
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export interface AnthropicMessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AnthropicToolUseBlock {
  id: string;
  name: string;
  input: unknown;
}

export interface PromptWithToolsOutput {
  textBlocks: string[];
  toolUseBlocks: AnthropicToolUseBlock[];
  model: string;
  stopReason: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AnthropicErrorResponse {
  error: {
    message: string;
    type: string;
    code?: string;
  };
}

export const usageBucketSchema = z.object({
  used_percent: z.number(),
  resets_in_seconds: z.number(),
  exceeded: z.boolean(),
});

export const usageOutput = z.object({
  product: z.string(),
  user_id: z.number(),
  sustained: usageBucketSchema,
  burst: usageBucketSchema,
  is_rate_limited: z.boolean(),
});

export type UsageBucket = z.infer<typeof usageBucketSchema>;
export type UsageOutput = z.infer<typeof usageOutput>;
