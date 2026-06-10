import type { SignalReportArtefactsResponse } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import { buildSignalPrompt } from "./signal-prompt";

type Artefact = SignalReportArtefactsResponse["results"][number];

// The runtime reads `relevant_code_paths`, `relevant_commit_hashes`, and
// `data_queried` from `content` via an unknown cast, so test fixtures don't
// need to match the static SignalFindingContent shape exactly.
const FINDING_ARTEFACT = {
  id: "a1",
  type: "signal_finding",
  content: {
    relevant_code_paths: ["src/checkout/index.ts", "src/auth/login.ts"],
    relevant_commit_hashes: { abc123: "fix typo", def456: "regression" },
    data_queried: "select count(*) from purchases where ...",
    verified: true,
  },
  created_at: "2026-05-13T00:00:00Z",
} as unknown as Artefact;

const REVIEWERS_ARTEFACT: Artefact = {
  id: "a2",
  type: "suggested_reviewers",
  content: [
    {
      github_login: "alice",
      github_name: "Alice Anderson",
      relevant_commits: [],
      user: null,
    },
    {
      github_login: "bob",
      github_name: null,
      relevant_commits: [],
      user: null,
    },
  ],
  created_at: "2026-05-13T00:00:00Z",
};

describe("buildSignalPrompt", () => {
  it("composes title, summary, findings, and reviewers when all present", () => {
    const prompt = buildSignalPrompt({
      report: {
        id: "sr-123",
        title: "Checkout flow has a bug",
        summary: "Users report checkout fails on cards starting with 5.",
      },
      artefacts: [FINDING_ARTEFACT, REVIEWERS_ARTEFACT],
    });

    expect(prompt).toContain("# Checkout flow has a bug");
    expect(prompt).toContain(
      "Users report checkout fails on cards starting with 5.",
    );
    expect(prompt).toContain("## Findings");
    expect(prompt).toContain(
      "Relevant paths: src/checkout/index.ts, src/auth/login.ts",
    );
    expect(prompt).toContain("Relevant commits: abc123, def456");
    expect(prompt).toContain("## Suggested reviewers");
    expect(prompt).toContain("@alice (Alice Anderson)");
    expect(prompt).toContain("@bob");
    expect(prompt).not.toContain("@bob (");
    expect(prompt).toContain("_Source: signal report sr-123_");
  });

  it("collapses missing fields silently", () => {
    const prompt = buildSignalPrompt({
      report: {
        id: "sr-bare",
        title: null,
        summary: null,
      },
      artefacts: [],
    });

    expect(prompt).not.toContain("# ");
    expect(prompt).not.toContain("## Findings");
    expect(prompt).not.toContain("## Suggested reviewers");
    expect(prompt).toContain("_Source: signal report sr-bare_");
  });

  it("includes summary even without title", () => {
    const prompt = buildSignalPrompt({
      report: { id: "sr-x", title: null, summary: "Just a summary." },
      artefacts: [],
    });

    expect(prompt).toContain("Just a summary.");
    expect(prompt.startsWith("Just a summary.")).toBe(true);
  });

  it("trims to 5 commit hashes max", () => {
    const manyHashes: Record<string, string> = {};
    for (let i = 0; i < 10; i++) manyHashes[`hash${i}`] = "msg";
    const finding = {
      ...FINDING_ARTEFACT,
      content: {
        relevant_code_paths: [],
        relevant_commit_hashes: manyHashes,
        data_queried: "",
      },
    } as unknown as Artefact;

    const prompt = buildSignalPrompt({
      report: { id: "sr-z", title: "T", summary: null },
      artefacts: [finding],
    });

    expect(prompt).toContain(
      "Relevant commits: hash0, hash1, hash2, hash3, hash4",
    );
    expect(prompt).not.toContain("hash5");
  });
});
