import { describe, expect, it } from "vitest";
import { BUILT_IN_TEMPLATES } from "./canvasTemplates";

const aiGateway = BUILT_IN_TEMPLATES.find((t) => t.id === "ai-gateway");

describe("AI gateway template", () => {
  it("is registered as a built-in", () => {
    expect(aiGateway).toBeDefined();
    expect(aiGateway?.builtIn).toBe(true);
    expect(aiGateway?.name).toBe("AI gateway");
  });

  it("bakes the exact gateway filter into the prompt", () => {
    // The $ai_gateway predicate is what separates gateway traffic from
    // SDK-emitted $ai_generation events — it must survive verbatim.
    expect(aiGateway?.systemPrompt).toContain(
      "event = '$ai_generation' AND properties.$ai_gateway = true",
    );
  });

  it("scopes time with date-range placeholders, not a baked-in interval", () => {
    const prompt = aiGateway?.systemPrompt ?? "";
    expect(prompt).toContain("{date_from}");
    expect(prompt).toContain("{date_to}");
    // The board must be refreshable, so the WHERE clause never bakes a window.
    expect(prompt).not.toContain(
      "timestamp >= now() - INTERVAL 30 DAY AND timestamp <",
    );
  });

  it.each([
    ["spend", "round(sum(toFloat(properties.$ai_total_cost_usd)), 4)"],
    ["requests", "SELECT count() FROM events"],
    ["input tokens", "sum(toFloat(properties.$ai_input_tokens))"],
    ["output tokens", "sum(toFloat(properties.$ai_output_tokens))"],
    [
      "tokens-per-model",
      "sum(toFloat(properties.$ai_input_tokens) + toFloat(properties.$ai_output_tokens))",
    ],
  ])("bakes the exact %s formula", (_name, formula) => {
    expect(aiGateway?.systemPrompt).toContain(formula);
  });

  it.each([
    ["OpenAI base URL", "baseURL: '<gateway base URL>/v1'"],
    ["Anthropic SDK import", "@anthropic-ai/sdk"],
    ["provider state path", '"$state": "/provider"'],
    ["language state path", '"$state": "/language"'],
  ])("bakes the %s into the connect section", (_name, snippet) => {
    expect(aiGateway?.systemPrompt).toContain(snippet);
  });

  it("bakes the empty-state probe filter without date placeholders", () => {
    // The probe runs before the canvas exists, so it uses a literal 30-day
    // window rather than the {date_from}/{date_to} placeholders.
    expect(aiGateway?.systemPrompt).toContain(
      "event = '$ai_generation' AND properties.$ai_gateway = true AND timestamp >= now() - INTERVAL 30 DAY",
    );
  });
});
