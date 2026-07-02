import { describe, expect, it } from "vitest";
import { buildAdditionalDirectoriesPrompt } from "./agent-prompts";

describe("buildAdditionalDirectoriesPrompt", () => {
  it.each([
    ["undefined", undefined],
    ["empty", []],
  ])("returns an empty string for %s directories", (_label, directories) => {
    expect(buildAdditionalDirectoriesPrompt(directories)).toBe("");
  });

  it("lists each directory in an <additional_directories> block", () => {
    const prompt = buildAdditionalDirectoriesPrompt([
      "/tmp/workspace/repos/posthog/posthog-js",
      "/tmp/workspace/repos/posthog/posthog.com",
    ]);

    expect(prompt).toContain(
      "<additional_directories>\n" +
        "  <directory>/tmp/workspace/repos/posthog/posthog-js</directory>\n" +
        "  <directory>/tmp/workspace/repos/posthog/posthog.com</directory>\n" +
        "</additional_directories>",
    );
  });

  it("escapes XML-significant characters in paths", () => {
    const prompt = buildAdditionalDirectoriesPrompt(["/tmp/a<b>&c"]);

    expect(prompt).toContain("<directory>/tmp/a&lt;b&gt;&amp;c</directory>");
    expect(prompt).not.toContain("<directory>/tmp/a<b>");
  });
});
