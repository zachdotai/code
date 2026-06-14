import { describe, expect, it } from "vitest";
import { buildTracesEndpoint } from "./constants";

describe("buildTracesEndpoint", () => {
  it.each([
    [
      "https host",
      "https://internal-c.posthog.com",
      "https://internal-c.posthog.com/i/v1/traces",
    ],
    [
      "trailing slash stripped",
      "https://eu.posthog.com/",
      "https://eu.posthog.com/i/v1/traces",
    ],
    [
      "multiple trailing slashes stripped",
      "https://us.posthog.com//",
      "https://us.posthog.com/i/v1/traces",
    ],
    [
      "localhost http allowed",
      "http://localhost:8010",
      "http://localhost:8010/i/v1/traces",
    ],
    [
      "127.0.0.1 http allowed",
      "http://127.0.0.1:8010",
      "http://127.0.0.1:8010/i/v1/traces",
    ],
  ])("returns endpoint for %s", (_case, host, expected) => {
    expect(buildTracesEndpoint(host)).toBe(expected);
  });

  it.each([
    ["non-localhost http rejected", "http://evil.example.com"],
    ["unparseable host rejected", "not a url"],
    ["empty host rejected", ""],
  ])("returns null for %s", (_case, host) => {
    expect(buildTracesEndpoint(host)).toBeNull();
  });
});
