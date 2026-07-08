import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { CloudRegion } from "@posthog/shared";
import { getLlmGatewayUrl } from "./gateway";

export const DEFAULT_MODEL = "claude-opus-4-8";

const MODELS_FETCH_TIMEOUT_MS = 5_000;

export interface GatewayModel {
  id: string;
  owned_by?: string;
  display_name?: string;
  context_window?: number;
  supports_vision?: boolean;
}

type ModelFamily = "anthropic" | "openai" | "cloudflare";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * Strips trailing slashes without a regex. `.replace(/\/+$/, "")` is
 * unanchored at the start, so the engine retries every possible split of
 * the `+` quantifier at every position when the string doesn't end where
 * expected — quadratic on a long run of slashes. A plain loop is O(n) and
 * has no such worst case.
 */
function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

function detectFamily(model: GatewayModel): ModelFamily {
  if (model.owned_by === "openai" || model.id.startsWith("gpt-")) {
    return "openai";
  }
  if (model.owned_by === "cloudflare" || model.id.startsWith("@cf/")) {
    return "cloudflare";
  }
  return "anthropic";
}

/**
 * The gateway URL a model of the given pi `api` should be routed through for
 * a given region. `openai-responses` models are served off the gateway's
 * `/v1` surface; every other API this provider uses is served off the
 * product root.
 */
export function gatewayBaseUrlForApi(api: string, region: CloudRegion): string {
  return gatewayBaseUrlForApiWithGatewayUrl(api, getLlmGatewayUrl(region));
}

export function gatewayBaseUrlForApiWithGatewayUrl(
  api: string,
  gatewayUrl: string,
): string {
  const normalized = stripTrailingSlashes(gatewayUrl);
  return api === "openai-responses" ? `${normalized}/v1` : normalized;
}

function toModelConfig(
  model: GatewayModel,
  region: CloudRegion,
  gatewayUrl?: string,
): ProviderModelConfig {
  const family = detectFamily(model);
  const name = model.display_name ?? model.id;
  const contextWindow = model.context_window ?? 200000;
  const input: ("text" | "image")[] = model.supports_vision
    ? ["text", "image"]
    : ["text"];

  if (family === "openai") {
    return {
      id: model.id,
      name,
      api: "openai-responses",
      baseUrl: gatewayUrl
        ? gatewayBaseUrlForApiWithGatewayUrl("openai-responses", gatewayUrl)
        : gatewayBaseUrlForApi("openai-responses", region),
      reasoning: true,
      input,
      cost: ZERO_COST,
      contextWindow,
      maxTokens: 128000,
    };
  }

  if (family === "cloudflare") {
    return {
      id: model.id,
      name,
      api: "anthropic-messages",
      reasoning: false,
      input,
      cost: ZERO_COST,
      contextWindow,
      maxTokens: 32000,
    };
  }

  const adaptiveThinking = /opus|sonnet|fable/.test(model.id);
  return {
    id: model.id,
    name,
    api: "anthropic-messages",
    reasoning: true,
    input,
    cost: ZERO_COST,
    contextWindow,
    maxTokens: 64000,
    ...(adaptiveThinking ? { compat: { forceAdaptiveThinking: true } } : {}),
  };
}

const FALLBACK_GATEWAY_MODELS: GatewayModel[] = [
  {
    id: "claude-opus-4-8",
    owned_by: "anthropic",
    context_window: 1000000,
    supports_vision: true,
  },
  {
    id: "claude-opus-4-7",
    owned_by: "anthropic",
    context_window: 1000000,
    supports_vision: true,
  },
  {
    id: "claude-sonnet-5",
    owned_by: "anthropic",
    context_window: 1000000,
    supports_vision: true,
  },
  {
    id: "claude-sonnet-4-6",
    owned_by: "anthropic",
    context_window: 1000000,
    supports_vision: true,
  },
  {
    id: "claude-haiku-4-5",
    owned_by: "anthropic",
    context_window: 200000,
    supports_vision: true,
  },
  {
    id: "gpt-5.5",
    owned_by: "openai",
    context_window: 1050000,
    supports_vision: true,
  },
  {
    id: "gpt-5.4",
    owned_by: "openai",
    context_window: 1050000,
    supports_vision: true,
  },
  {
    id: "gpt-5.3-codex",
    owned_by: "openai",
    context_window: 272000,
    supports_vision: true,
  },
  {
    id: "gpt-5-mini",
    owned_by: "openai",
    context_window: 272000,
    supports_vision: true,
  },
  {
    id: "@cf/zai-org/glm-5.2",
    owned_by: "cloudflare",
    context_window: 128000,
    supports_vision: false,
  },
];

export function fallbackModelConfigs(
  region: CloudRegion,
  gatewayUrl?: string,
): ProviderModelConfig[] {
  return FALLBACK_GATEWAY_MODELS.map((model) =>
    toModelConfig(model, region, gatewayUrl),
  );
}

async function fetchGatewayModels(
  region: CloudRegion,
  gatewayUrl?: string,
): Promise<GatewayModel[]> {
  if (process.env.PI_OFFLINE || process.env.HARNESS_STATIC_MODELS) {
    return [];
  }
  try {
    const baseUrl = gatewayUrl
      ? stripTrailingSlashes(gatewayUrl)
      : getLlmGatewayUrl(region);
    const response = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as { data?: GatewayModel[] };
    return Array.isArray(body.data) ? body.data : [];
  } catch {
    return [];
  }
}

export async function resolveModelConfigs(
  region: CloudRegion,
  gatewayUrl?: string,
): Promise<ProviderModelConfig[]> {
  const live = await fetchGatewayModels(region, gatewayUrl);
  if (live.length === 0) {
    return fallbackModelConfigs(region, gatewayUrl);
  }
  return live
    .filter((model) => Boolean(model.id))
    .map((model) => toModelConfig(model, region, gatewayUrl));
}
