import { logger } from "./logger";
import {
  clampReasoningEffortForAdapter,
  DEFAULT_HOGLET_ENVIRONMENT,
  DEFAULT_HOGLET_RUNTIME_ADAPTER,
  defaultModelForAdapter,
  defaultReasoningEffortForAdapter,
  type HogletRuntimeAdapter,
  hogletRuntimeAdapter,
  modelIdentifierSchema,
  type NestLoadout,
  type RtsReasoningEffort,
  rtsReasoningEffort,
} from "./schemas";
import { getRendererSettingsSnapshot } from "./settings";

const log = logger.scope("hoglet-runtime-preferences");

export interface UserTaskPreferences {
  runtimeAdapter?: HogletRuntimeAdapter;
  model?: string;
  reasoningEffort?: RtsReasoningEffort;
}

export interface ResolvedHogletRuntime {
  runtimeAdapter: HogletRuntimeAdapter;
  model: string;
  reasoningEffort: RtsReasoningEffort;
  executionMode: HogletExecutionMode;
  environment: "local" | "cloud";
}

export type HogletExecutionMode =
  | NonNullable<NestLoadout["executionMode"]>
  | "bypassPermissions";

export function readUserTaskPreferences(): UserTaskPreferences {
  const state = getRendererSettingsSnapshot();
  if (!state) return {};

  try {
    const runtimeAdapter = hogletRuntimeAdapter.safeParse(
      state.lastUsedAdapter,
    );
    const reasoningEffort = rtsReasoningEffort.safeParse(
      state.lastUsedReasoningEffort,
    );
    const lastUsedModel =
      state.lastUsedModel == null ? undefined : state.lastUsedModel;
    const modelParse = modelIdentifierSchema.safeParse(lastUsedModel);
    if (!modelParse.success && lastUsedModel !== undefined) {
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
