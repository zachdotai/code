// RTS-local client for the PostHog LLM gateway.
//
// Lives in workspace-server (not @posthog/core) because workspace-server may
// not import core; the RTS services that need tool-calling LLM access run
// here next to the RTS repositories. Auth comes in through the RtsAuth port
// bound by the host.
import { DEFAULT_GATEWAY_MODEL } from "@posthog/agent/gateway-models";
import {
  getGatewayInvalidatePlanCacheUrl,
  getGatewayUsageUrl,
  getLlmGatewayUrl,
} from "@posthog/agent/posthog-api";
import { inject, injectable } from "inversify";
import { z } from "zod";
import { RTS_AUTH } from "./identifiers";
import { logger } from "./logger";
import type { RtsAuth } from "./ports";

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
  reset_at: z.string().datetime(),
  exceeded: z.boolean(),
});

export const usageOutput = z.object({
  product: z.string(),
  user_id: z.number(),
  sustained: usageBucketSchema,
  burst: usageBucketSchema,
  is_rate_limited: z.boolean(),
  is_pro: z.boolean(),
  billing_period_end: z.string().datetime().nullable().optional(),
});

export type UsageBucket = z.infer<typeof usageBucketSchema>;
export type UsageOutput = z.infer<typeof usageOutput>;

const log = logger.scope("rts-llm-gateway");

export class LlmGatewayError extends Error {
  constructor(
    message: string,
    public readonly type: string,
    public readonly code?: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "LlmGatewayError";
  }
}

@injectable()
export class LlmGatewayService {
  constructor(
    @inject(RTS_AUTH)
    private readonly authService: RtsAuth,
  ) {}

  async prompt(
    messages: LlmMessage[],
    options: {
      system?: string;
      maxTokens?: number;
      model?: string;
      betas?: string[];
      effort?: LlmGatewayEffortLevel;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ): Promise<PromptOutput> {
    const {
      system,
      maxTokens,
      model = DEFAULT_GATEWAY_MODEL,
      betas,
      effort,
      signal,
      timeoutMs = 60_000,
    } = options;

    const auth = await this.authService.getValidAccessToken();
    const gatewayUrl = getLlmGatewayUrl(auth.apiHost);
    const messagesUrl = `${gatewayUrl}/v1/messages`;

    const requestBody: AnthropicMessagesRequest = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    };

    if (maxTokens !== undefined) {
      requestBody.max_tokens = maxTokens;
    }

    if (system) {
      requestBody.system = system;
    }

    if (effort) {
      requestBody.output_config = { effort };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (betas?.length) {
      headers["anthropic-beta"] = betas.join(",");
    }

    log.debug("Sending request to LLM gateway", {
      url: messagesUrl,
      model,
      messageCount: messages.length,
      betas,
      effort,
    });

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, timeoutMs);
    const onCallerAbort = () => timeoutController.abort();
    if (signal) {
      if (signal.aborted) timeoutController.abort();
      else signal.addEventListener("abort", onCallerAbort, { once: true });
    }

    let response: Response;
    try {
      response = await this.authService.authenticatedFetch(fetch, messagesUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: timeoutController.signal,
      });
    } catch (err) {
      if (timeoutController.signal.aborted && !signal?.aborted) {
        throw new LlmGatewayError(
          `LLM gateway request timed out after ${timeoutMs}ms`,
          "timeout",
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onCallerAbort);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      let errorData: AnthropicErrorResponse | null = null;

      try {
        errorData = JSON.parse(errorBody) as AnthropicErrorResponse;
      } catch {
        log.error("Failed to parse error response", {
          errorBody,
          status: response.status,
        });
      }

      const errorMessage =
        errorData?.error?.message ||
        `HTTP ${response.status}: ${response.statusText}`;
      const errorType = errorData?.error?.type || "unknown_error";
      const errorCode = errorData?.error?.code;

      log.error("LLM gateway request failed", {
        status: response.status,
        errorType,
        errorMessage,
      });

      throw new LlmGatewayError(
        errorMessage,
        errorType,
        errorCode,
        response.status,
      );
    }

    const data = (await response.json()) as AnthropicMessagesResponse;

    const textContent = data.content.find((c) => c.type === "text");
    const content = textContent?.type === "text" ? textContent.text : "";

    log.debug("LLM gateway response received", {
      model: data.model,
      stopReason: data.stop_reason,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
    });

    return {
      content,
      model: data.model,
      stopReason: data.stop_reason,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      },
    };
  }

  /**
   * Like `prompt` but with Claude tool calling. Returns parsed text + tool_use
   * blocks separately so the caller can dispatch tools without re-walking the
   * content array.
   */
  async promptWithTools(
    messages: LlmMessage[],
    options: {
      system?: string;
      maxTokens?: number;
      model?: string;
      effort?: LlmGatewayEffortLevel;
      tools: AnthropicToolDefinition[];
      toolChoice?: AnthropicToolChoice;
      signal?: AbortSignal;
    },
  ): Promise<PromptWithToolsOutput> {
    const {
      system,
      maxTokens,
      model = DEFAULT_GATEWAY_MODEL,
      effort,
      tools,
      toolChoice,
      signal,
    } = options;

    const auth = await this.authService.getValidAccessToken();
    const gatewayUrl = getLlmGatewayUrl(auth.apiHost);
    const messagesUrl = `${gatewayUrl}/v1/messages`;

    const requestBody: AnthropicMessagesRequest = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      tools,
    };

    if (maxTokens !== undefined) {
      requestBody.max_tokens = maxTokens;
    }

    if (system) {
      requestBody.system = system;
    }

    if (effort) {
      requestBody.output_config = { effort };
    }

    if (toolChoice) {
      requestBody.tool_choice = toolChoice;
    }

    log.debug("Sending tools request to LLM gateway", {
      url: messagesUrl,
      model,
      effort,
      messageCount: messages.length,
      toolCount: tools.length,
    });

    const response = await this.authService.authenticatedFetch(
      fetch,
      messagesUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal,
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      let errorData: AnthropicErrorResponse | null = null;

      try {
        errorData = JSON.parse(errorBody) as AnthropicErrorResponse;
      } catch {
        log.error("Failed to parse error response", {
          errorBody,
          status: response.status,
        });
      }

      const errorMessage =
        errorData?.error?.message ||
        `HTTP ${response.status}: ${response.statusText}`;
      const errorType = errorData?.error?.type || "unknown_error";
      const errorCode = errorData?.error?.code;

      log.error("LLM gateway tools request failed", {
        status: response.status,
        errorType,
        errorMessage,
      });

      throw new LlmGatewayError(
        errorMessage,
        errorType,
        errorCode,
        response.status,
      );
    }

    const data = (await response.json()) as AnthropicMessagesResponse;

    const textBlocks: string[] = [];
    const toolUseBlocks: AnthropicToolUseBlock[] = [];
    for (const block of data.content) {
      if (block.type === "text") {
        textBlocks.push(block.text);
      } else if (block.type === "tool_use") {
        toolUseBlocks.push({
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }

    log.debug("LLM gateway tools response received", {
      model: data.model,
      stopReason: data.stop_reason,
      textBlocks: textBlocks.length,
      toolUseBlocks: toolUseBlocks.length,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
    });

    return {
      textBlocks,
      toolUseBlocks,
      model: data.model,
      stopReason: data.stop_reason,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      },
    };
  }

  async fetchUsage(): Promise<UsageOutput> {
    const auth = await this.authService.getValidAccessToken();
    const usageUrl = getGatewayUsageUrl(auth.apiHost);

    log.debug("Fetching usage from gateway", { url: usageUrl });

    let response: Response;
    try {
      response = await this.authService.authenticatedFetch(fetch, usageUrl);
    } catch (err) {
      log.warn("Usage fetch network error", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    if (!response.ok) {
      log.warn("Usage fetch failed", { status: response.status });
      throw new LlmGatewayError(
        `Failed to fetch usage: HTTP ${response.status}`,
        "usage_error",
        undefined,
        response.status,
      );
    }

    return usageOutput.parse(await response.json());
  }

  async invalidatePlanCache(): Promise<void> {
    const auth = await this.authService.getValidAccessToken();
    const url = getGatewayInvalidatePlanCacheUrl(auth.apiHost);

    log.debug("Invalidating plan cache", { url });

    const response = await this.authService.authenticatedFetch(fetch, url, {
      method: "POST",
    });

    if (!response.ok) {
      throw new LlmGatewayError(
        `Failed to invalidate plan cache: HTTP ${response.status}`,
        "plan_cache_error",
        undefined,
        response.status,
      );
    }
  }
}
