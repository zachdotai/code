import { logger } from "../../utils/logger";

const log = logger.scope("hedgemony-usage-pricing");

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M: number;
  cacheCreationPer1M: number;
}

// USD per 1M tokens. Used as a fallback when the SDK does not return a
// total_cost_usd (Codex / non-Claude routes). Update when vendor prices change.
const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-7": {
    inputPer1M: 15.0,
    outputPer1M: 75.0,
    cacheReadPer1M: 1.5,
    cacheCreationPer1M: 18.75,
  },
  "claude-sonnet-4-6": {
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    cacheReadPer1M: 0.3,
    cacheCreationPer1M: 3.75,
  },
  "claude-haiku-4-5": {
    inputPer1M: 1.0,
    outputPer1M: 5.0,
    cacheReadPer1M: 0.1,
    cacheCreationPer1M: 1.25,
  },
  "gpt-5.5": {
    inputPer1M: 5.0,
    outputPer1M: 20.0,
    cacheReadPer1M: 0.5,
    cacheCreationPer1M: 5.0,
  },
};

function resolvePricing(model: string): ModelPricing | null {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // Tolerate dated variants like "claude-sonnet-4-6-20251001".
  for (const key of Object.keys(MODEL_PRICING)) {
    if (model.startsWith(key)) return MODEL_PRICING[key];
  }
  return null;
}

export function computeCostUsd(usage: TokenCounts, model: string): number {
  const pricing = resolvePricing(model);
  if (!pricing) {
    log.warn("Unknown model for cost computation; returning 0", { model });
    return 0;
  }
  const million = 1_000_000;
  return (
    (usage.inputTokens * pricing.inputPer1M) / million +
    (usage.outputTokens * pricing.outputPer1M) / million +
    (usage.cacheReadTokens * pricing.cacheReadPer1M) / million +
    (usage.cacheCreationTokens * pricing.cacheCreationPer1M) / million
  );
}

export function hasPricingFor(model: string): boolean {
  return resolvePricing(model) !== null;
}
