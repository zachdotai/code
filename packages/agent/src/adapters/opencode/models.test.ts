import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import {
  formatOpencodeModelName,
  modelIdFromConfigOptions,
  normalizeOpencodeConfigOptions,
} from "./models";

const modelSelect = (
  options: unknown,
  currentValue = "posthog/@cf/zai-org/glm-5.2",
): SessionConfigOption =>
  ({
    id: "model",
    name: "Model",
    type: "select",
    category: "model",
    currentValue,
    options,
  }) as unknown as SessionConfigOption;

describe("formatOpencodeModelName", () => {
  it("strips the posthog/ provider prefix and takes the final path segment", () => {
    expect(formatOpencodeModelName("posthog/@cf/zai-org/glm-5.2")).toBe(
      "glm-5.2",
    );
    expect(formatOpencodeModelName("@cf/zai-org/glm-5.2")).toBe("glm-5.2");
  });
});

describe("modelIdFromConfigOptions", () => {
  it("returns the model option's currentValue", () => {
    expect(modelIdFromConfigOptions([modelSelect([])])).toBe(
      "posthog/@cf/zai-org/glm-5.2",
    );
  });

  it("returns undefined when there is no model option", () => {
    expect(modelIdFromConfigOptions([])).toBeUndefined();
    expect(modelIdFromConfigOptions(undefined)).toBeUndefined();
  });
});

describe("normalizeOpencodeConfigOptions", () => {
  it("keeps only posthog/* models and cleans their names (flat)", () => {
    const result = normalizeOpencodeConfigOptions([
      modelSelect([
        { value: "openai/gpt-5", name: "OpenAI/GPT-5" },
        {
          value: "anthropic/claude-opus-4-8",
          name: "Anthropic/Claude Opus 4.8",
        },
        {
          value: "posthog/@cf/zai-org/glm-5.2",
          name: "PostHog Gateway/GLM 5.2",
        },
      ]),
    ]);
    const model = result?.find((o) => o.category === "model");
    expect((model as { options: unknown }).options).toEqual([
      { value: "posthog/@cf/zai-org/glm-5.2", name: "glm-5.2" },
    ]);
  });

  it("filters grouped options and drops empty groups", () => {
    const result = normalizeOpencodeConfigOptions([
      modelSelect([
        {
          group: "openai",
          name: "OpenAI",
          options: [{ value: "openai/gpt-5", name: "GPT-5" }],
        },
        {
          group: "posthog",
          name: "PostHog",
          options: [{ value: "posthog/@cf/zai-org/glm-5.2", name: "GLM 5.2" }],
        },
      ]),
    ]);
    const model = result?.find((o) => o.category === "model");
    expect((model as { options: unknown }).options).toEqual([
      {
        group: "posthog",
        name: "PostHog",
        options: [{ value: "posthog/@cf/zai-org/glm-5.2", name: "glm-5.2" }],
      },
    ]);
  });

  it("leaves non-model options untouched", () => {
    const modeOption = {
      id: "mode",
      name: "Mode",
      type: "select",
      category: "mode",
      currentValue: "auto",
      options: [{ value: "auto", name: "Auto" }],
    } as unknown as SessionConfigOption;
    expect(normalizeOpencodeConfigOptions([modeOption])).toEqual([modeOption]);
  });

  it("returns null/undefined input unchanged", () => {
    expect(normalizeOpencodeConfigOptions(null)).toBeNull();
    expect(normalizeOpencodeConfigOptions(undefined)).toBeUndefined();
  });
});
