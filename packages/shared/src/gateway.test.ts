import { describe, expect, it } from "vitest";
import {
  getGatewayInvalidatePlanCacheUrl,
  getGatewayUsageUrl,
  getLlmGatewayUrl,
} from "./gateway";

describe("getLlmGatewayUrl", () => {
  it.each([
    {
      host: "https://us.posthog.com",
      expected: "https://gateway.us.posthog.com/posthog_code",
    },
    {
      host: "https://eu.posthog.com",
      expected: "https://gateway.eu.posthog.com/posthog_code",
    },
    {
      // Unknown self-hosted host falls back to the US gateway.
      host: "https://app.example.com",
      expected: "https://gateway.us.posthog.com/posthog_code",
    },
    {
      host: "http://localhost:8000",
      expected: "http://localhost:3308/posthog_code",
    },
    {
      host: "http://127.0.0.1:8000",
      expected: "http://localhost:3308/posthog_code",
    },
  ])("maps $host -> $expected", ({ host, expected }) => {
    expect(getLlmGatewayUrl(host)).toBe(expected);
  });

  it("respects the product segment", () => {
    expect(getLlmGatewayUrl("https://eu.posthog.com", "slack_app")).toBe(
      "https://gateway.eu.posthog.com/slack_app",
    );
  });
});

describe("usage urls", () => {
  it("builds the usage url", () => {
    expect(getGatewayUsageUrl("https://us.posthog.com")).toBe(
      "https://gateway.us.posthog.com/v1/usage/posthog_code",
    );
  });

  it("builds the invalidate-plan-cache url", () => {
    expect(getGatewayInvalidatePlanCacheUrl("https://us.posthog.com")).toBe(
      "https://gateway.us.posthog.com/v1/usage/posthog_code/invalidate-plan-cache",
    );
  });
});
