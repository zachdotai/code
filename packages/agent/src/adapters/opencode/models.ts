import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
} from "@agentclientprotocol/sdk";

// All gateway models are registered in the generated opencode.json under this
// provider key, so opencode surfaces them as `posthog/<modelId>` in its config
// options. We keep only those — opencode otherwise lists its ~80 built-in models
// (gpt-*, claude-*, embeddings, image) which we don't want in the Code picker.
export const OPENCODE_PROVIDER_PREFIX = "posthog/";

export function formatOpencodeModelName(value: string): string {
  const withoutProvider = value.startsWith(OPENCODE_PROVIDER_PREFIX)
    ? value.slice(OPENCODE_PROVIDER_PREFIX.length)
    : value;
  // GLM ids are slash-paths ("@cf/zai-org/glm-5.2") — take the final segment.
  return (withoutProvider.split("/").pop() ?? withoutProvider).toLowerCase();
}

export function modelIdFromConfigOptions(
  configOptions: SessionConfigOption[] | null | undefined,
): string | undefined {
  const modelOption = configOptions?.find((o) => o.category === "model");
  return typeof modelOption?.currentValue === "string"
    ? modelOption.currentValue
    : undefined;
}

function isPosthogModel(opt: SessionConfigSelectOption): boolean {
  return opt.value.startsWith(OPENCODE_PROVIDER_PREFIX);
}

/**
 * Restrict the model picker to our gateway provider and give each entry a clean
 * label. Filters opencode's full built-in catalogue down to `posthog/*`.
 */
export function normalizeOpencodeConfigOptions(
  configOptions: SessionConfigOption[] | null | undefined,
): SessionConfigOption[] | null | undefined {
  if (!configOptions) return configOptions;

  const formatOption = (
    opt: SessionConfigSelectOption,
  ): SessionConfigSelectOption => ({
    ...opt,
    name: formatOpencodeModelName(opt.value),
  });

  return configOptions.map((option) => {
    if (option.category !== "model" || option.type !== "select") return option;
    const options = option.options;
    if (options.length === 0) return option;
    const isGroup = "group" in options[0];

    if (isGroup) {
      const groups = (options as SessionConfigSelectGroup[])
        .map((group) => ({
          ...group,
          options: group.options.filter(isPosthogModel).map(formatOption),
        }))
        .filter((group) => group.options.length > 0);
      return { ...option, options: groups } as SessionConfigOption;
    }

    return {
      ...option,
      options: (options as SessionConfigSelectOption[])
        .filter(isPosthogModel)
        .map(formatOption),
    } as SessionConfigOption;
  });
}
