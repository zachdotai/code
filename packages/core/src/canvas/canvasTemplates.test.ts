import { describe, expect, it } from "vitest";
import { BUILT_IN_TEMPLATES, freeformSystemPromptFor } from "./canvasTemplates";

const aiGateway = BUILT_IN_TEMPLATES.find((t) => t.id === "ai-gateway");
// The gen path resolves a canvas's prompt by templateId, not via the template
// record — so assert against the prompt freeformSystemPromptFor actually returns.
const prompt = freeformSystemPromptFor("ai-gateway");

describe("AI gateway template", () => {
  it("is offered as a selectable built-in", () => {
    expect(aiGateway).toBeDefined();
    expect(aiGateway?.builtIn).toBe(true);
    expect(aiGateway?.name).toBe("AI gateway");
  });

  it("resolves a distinct React-tier prompt by templateId", () => {
    expect(prompt).not.toBe(freeformSystemPromptFor("freeform"));
    // It is a React-tier prompt, so it carries the freeform contract.
    expect(prompt).toContain("freeform React app");
  });

  it("bakes the exact gateway filter into the prompt", () => {
    // The $ai_gateway predicate is what separates gateway traffic from
    // SDK-emitted $ai_generation events — it must survive verbatim.
    expect(prompt).toContain(
      "event = '$ai_generation' AND properties.$ai_gateway = true",
    );
  });

  it("drives the window from the date control, not a baked-in interval", () => {
    // React-tier boards own a DateTimePicker and a half-open window; the live
    // queries must not bake a rolling interval into their WHERE clause.
    expect(prompt).toContain("DATE WINDOW");
    expect(prompt).toContain("toDateTime(fromUnix)");
  });

  it.each([
    ["spend", "round(sum(toFloat(properties.$ai_total_cost_usd)), 4)"],
    ["requests", "count()"],
    ["input tokens", "sum(toFloat(properties.$ai_input_tokens))"],
    ["output tokens", "sum(toFloat(properties.$ai_output_tokens))"],
    [
      "tokens-per-model",
      "sum(toFloat(properties.$ai_input_tokens) + toFloat(properties.$ai_output_tokens))",
    ],
  ])("bakes the exact %s formula", (_name, formula) => {
    expect(prompt).toContain(formula);
  });

  it.each([
    ["OpenAI base URL", "baseURL: '<gateway base URL>/v1'"],
    ["Anthropic SDK import", "@anthropic-ai/sdk"],
    ["provider state", 'useState("openai")'],
    ["language state", 'useState("typescript")'],
  ])("bakes the %s into the connect section", (_name, snippet) => {
    expect(prompt).toContain(snippet);
  });

  it("bakes the empty-state probe filter without date placeholders", () => {
    // The probe runs before the canvas exists, so it uses a literal 30-day
    // window rather than the picker's half-open bounds.
    expect(prompt).toContain(
      "event = '$ai_generation' AND properties.$ai_gateway = true AND timestamp >= now() - INTERVAL 30 DAY",
    );
  });
});
