import { describe, expect, it } from "vitest";
import { parseRepoSlug } from "./repo-slug";

describe("parseRepoSlug", () => {
  it.each([
    // Sanity: the two remote forms we actually see (scp-like SSH + HTTPS).
    { url: "git@github.com:owner/name.git", expected: "owner/name" },
    { url: "https://github.com/owner/name", expected: "owner/name" },
  ])("parses $url", ({ url, expected }) => {
    expect(parseRepoSlug(url)).toBe(expected);
  });

  it.each([
    { url: null },
    { url: undefined },
    { url: "" },
    { url: "   " },
    // Nested path (GitLab subgroup) packs the extra segment into owner — omit.
    { url: "git@gitlab.com:group/subgroup/name.git" },
    // Single segment leaves owner empty — omit.
    { url: "https://github.com/name" },
    // Local path, no host/owner/name — omit.
    { url: "/Users/dev/repo" },
    { url: "not a url" },
  ])("omits $url", ({ url }) => {
    expect(parseRepoSlug(url)).toBeNull();
  });
});
