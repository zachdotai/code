export type ExecutionMode = "default" | "acceptEdits" | "plan" | "auto";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export const EXECUTION_MODES: {
  value: ExecutionMode;
  label: string;
  description: string;
}[] = [
  {
    value: "plan",
    label: "Plan Mode",
    description: "Plan first, no tool execution",
  },
  {
    value: "default",
    label: "Default",
    description: "Standard behaviour, prompts for dangerous operations",
  },
  {
    value: "acceptEdits",
    label: "Accept Edits",
    description: "Auto-accept file edit operations",
  },
  {
    value: "auto",
    label: "Auto",
    description: "Model decides which prompts to approve or deny",
  },
];

export interface ModelOption {
  value: string;
  label: string;
  description?: string;
  supportsReasoning: boolean;
}

/**
 * Last-resort model list. The real list is downloaded from the LLM gateway
 * (see `getAvailableModels` / `useModels`), exactly like the desktop app. This
 * only renders on a cold start before the first fetch lands, or if the gateway
 * is unreachable, so the picker is never empty.
 */
export const FALLBACK_MODELS: ModelOption[] = [
  {
    value: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    description: "Most capable, slower",
    supportsReasoning: true,
  },
  {
    value: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    description: "Balanced",
    supportsReasoning: true,
  },
];

export const REASONING_LEVELS: {
  value: ReasoningEffort;
  label: string;
}[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
];

export const DEFAULT_EXECUTION_MODE: ExecutionMode = "plan";
export const DEFAULT_MODEL = "claude-opus-4-8";
export const DEFAULT_REASONING: ReasoningEffort = "high";

export function modelLabel(
  value: string,
  models: ModelOption[] = FALLBACK_MODELS,
): string {
  return models.find((m) => m.value === value)?.label ?? value;
}

export function modeLabel(value: ExecutionMode): string {
  return EXECUTION_MODES.find((m) => m.value === value)?.label ?? value;
}

export function reasoningLabel(value: ReasoningEffort): string {
  return REASONING_LEVELS.find((r) => r.value === value)?.label ?? value;
}

export function modelSupportsReasoning(
  value: string,
  models: ModelOption[] = FALLBACK_MODELS,
): boolean {
  return models.find((m) => m.value === value)?.supportsReasoning ?? false;
}
