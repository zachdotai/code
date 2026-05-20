import { decrypt } from "../../utils/encryption";
import { logger } from "../../utils/logger";
import { rendererStore } from "../../utils/store";
import {
  clampReasoningEffortForAdapter,
  DEFAULT_HOGLET_ENVIRONMENT,
  DEFAULT_HOGLET_RUNTIME_ADAPTER,
  defaultModelForAdapter,
  defaultReasoningEffortForAdapter,
  type HedgemonyReasoningEffort,
  type HogletRuntimeAdapter,
  hedgemonyReasoningEffort,
  hogletRuntimeAdapter,
  modelIdentifierSchema,
  type NestLoadout,
} from "./schemas";

const log = logger.scope("hoglet-runtime-preferences");

interface RendererSettingsState {
  lastUsedAdapter?: unknown;
  lastUsedModel?: unknown;
  lastUsedReasoningEffort?: unknown;
}

export interface UserTaskPreferences {
  runtimeAdapter?: HogletRuntimeAdapter;
  model?: string;
  reasoningEffort?: HedgemonyReasoningEffort;
}

export interface ResolvedHogletRuntime {
  runtimeAdapter: HogletRuntimeAdapter;
  model: string;
  reasoningEffort: HedgemonyReasoningEffort;
  executionMode: HogletExecutionMode;
  environment: "local" | "cloud";
}

export type HogletExecutionMode =
  | NonNullable<NestLoadout["executionMode"]>
  | "bypassPermissions";

export function readUserTaskPreferences(): UserTaskPreferences {
  if (!rendererStore.has("settings-storage")) return {};
  const encrypted = rendererStore.get("settings-storage");
  if (typeof encrypted !== "string") return {};
  const decrypted = decrypt(encrypted);
  if (!decrypted) return {};

  try {
    const parsed = JSON.parse(decrypted) as { state?: RendererSettingsState };
    const state = parsed.state ?? {};
    const runtimeAdapter = hogletRuntimeAdapter.safeParse(
      state.lastUsedAdapter,
    );
    const reasoningEffort = hedgemonyReasoningEffort.safeParse(
      state.lastUsedReasoningEffort,
    );
    const modelParse = modelIdentifierSchema.safeParse(state.lastUsedModel);
    if (!modelParse.success && state.lastUsedModel !== undefined) {
      log.warn("lastUsedModel rejected; using adapter default", {
        issues: modelParse.error.issues.map((issue) => issue.code),
      });
    }
    return {
      runtimeAdapter: runtimeAdapter.success ? runtimeAdapter.data : undefined,
      model: modelParse.success ? modelParse.data : undefined,
      reasoningEffort: reasoningEffort.success
        ? reasoningEffort.data
        : undefined,
    };
  } catch {
    return {};
  }
}

export function resolveHogletRuntime(
  loadout: NestLoadout,
  preferences: UserTaskPreferences,
): ResolvedHogletRuntime {
  const runtimeAdapter =
    loadout.runtimeAdapter ??
    preferences.runtimeAdapter ??
    DEFAULT_HOGLET_RUNTIME_ADAPTER;
  const preferredModel =
    preferences.runtimeAdapter === runtimeAdapter
      ? preferences.model
      : undefined;
  const model =
    loadout.model ?? preferredModel ?? defaultModelForAdapter(runtimeAdapter);
  const reasoningEffort = clampReasoningEffortForAdapter(
    loadout.reasoningEffort ??
      preferences.reasoningEffort ??
      defaultReasoningEffortForAdapter(runtimeAdapter),
    runtimeAdapter,
  );
  const executionMode =
    loadout.executionMode ?? defaultExecutionModeForAdapter(runtimeAdapter);
  return {
    runtimeAdapter,
    model,
    reasoningEffort,
    executionMode,
    environment: loadout.environment ?? DEFAULT_HOGLET_ENVIRONMENT,
  };
}

export function defaultExecutionModeForAdapter(
  adapter: HogletRuntimeAdapter,
): HogletExecutionMode {
  // Hoglets are background workers: permission prompts strand them until an
  // operator opens the task. Use autonomous defaults unless the nest loadout
  // explicitly asks for a stricter mode.
  return adapter === "codex" ? "full-access" : "bypassPermissions";
}
