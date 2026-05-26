import { describe, expect, it } from "vitest";
import type { Integration } from "../stores/integrationStore";
import {
  githubInstallationSettingsUrl,
  resolveGithubInstallationId,
} from "./githubInstallationSettingsUrl";

describe("githubInstallationSettingsUrl", () => {
  it("uses org settings for organization accounts", () => {
    expect(
      githubInstallationSettingsUrl("99", {
        type: "Organization",
        name: "posthog",
      }),
    ).toBe(
      "https://github.com/organizations/posthog/settings/installations/99",
    );
  });

  it("uses user settings for personal accounts", () => {
    expect(
      githubInstallationSettingsUrl("42", { type: "User", name: "octocat" }),
    ).toBe("https://github.com/settings/installations/42");
  });
});
describe("resolveGithubInstallationId", () => {
  it.each([
    [
      "prefers top-level installation_id over integration_id and config",
      { id: 99, kind: "github", installation_id: "a", config: { installation_id: "c" } },
      "a",
    ],
    [
      "falls back to integration_id when installation_id is absent",
      { id: 1, kind: "github", integration_id: 12345 },
      "12345",
    ],
    [
      "falls back to config.installation_id as last resort",
      { id: 1, kind: "github", config: { installation_id: "c" } },
      "c",
    ],
  ])("%s", (_label, input, expected) => {
    expect(resolveGithubInstallationId(input as Parameters<typeof resolveGithubInstallationId>[0])).toBe(expected);
  });
});
      expect(resolveGithubInstallationId(input)).toBe(expected);
    },
  );
});
