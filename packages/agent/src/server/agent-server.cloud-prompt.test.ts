import { afterEach, describe, expect, it } from "vitest";
import { TEST_PUBLIC_KEY } from "../test/fixtures/config";
import { AgentServer } from "./agent-server";

// `buildCloudSystemPrompt` is a pure string builder — no git repo needed — so
// these tests construct the server directly and skip the git-backed fixtures in
// agent-server.test.ts (whose `git commit` setup can't run in sandboxes that
// block git commit). They lock in the prompt-cache prefix-stability relocation:
// per-task values (PR URL, base branch, Slack/inbox links) live in a first-turn
// "task facts" block and are never interpolated into the cached system prompt.

interface CloudPromptServer {
  buildCloudSystemPrompt(hasPr: boolean): string;
  buildCloudTaskFacts(
    prUrl?: string | null,
    slackThreadUrl?: string | null,
    inboxReportUrl?: string | null,
    baseBranch?: string | null,
  ): string | undefined;
  buildCodexInstructions(
    systemPrompt: string | { append: string },
    taskFacts?: string,
  ): string;
}

function makeServer(
  overrides: Record<string, unknown> = {},
): CloudPromptServer {
  const server = new AgentServer({
    port: 0,
    jwtPublicKey: TEST_PUBLIC_KEY,
    repositoryPath: "/tmp/fake-repo",
    apiUrl: "http://localhost:8000",
    apiKey: "test-api-key",
    projectId: 1,
    mode: "interactive",
    taskId: "test-task-id",
    runId: "test-run-id",
    ...overrides,
  } as ConstructorParameters<typeof AgentServer>[0]);
  return server as unknown as CloudPromptServer;
}

describe("cloud system prompt — prefix stability", () => {
  afterEach(() => {
    delete process.env.POSTHOG_CODE_INTERACTION_ORIGIN;
  });

  const PR_URL = "https://github.com/PostHog/code/pull/42";
  const SLACK_URL = "https://posthog.slack.com/archives/C1/p1";
  const INBOX_URL = "http://localhost:8000/project/1/inbox/r1";

  it("keeps the auto-PR system prompt free of the base branch value", () => {
    process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
    const prompt = makeServer({
      baseBranch: "release-2.0",
    }).buildCloudSystemPrompt(false);
    expect(prompt).toContain("gh pr create --draft");
    expect(prompt).not.toContain("release-2.0");
    expect(prompt).toContain("task facts");
  });

  it("keeps the existing-PR system prompt free of the PR URL", () => {
    process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
    const prompt = makeServer().buildCloudSystemPrompt(true);
    expect(prompt).not.toContain("github.com");
    expect(prompt).toContain("task facts");
    expect(prompt).toContain("gh pr checkout <the PR URL from the task facts>");
  });

  it("does not interpolate Slack/inbox URLs into the footer", () => {
    process.env.POSTHOG_CODE_INTERACTION_ORIGIN = "slack";
    const prompt = makeServer().buildCloudSystemPrompt(false);
    expect(prompt).not.toContain("posthog.slack.com");
    expect(prompt).not.toContain("/inbox/");
  });

  it("collects all per-task values into the task-facts block", () => {
    const facts = makeServer().buildCloudTaskFacts(
      PR_URL,
      SLACK_URL,
      INBOX_URL,
      "main",
    );
    expect(facts).toContain("<task_facts>");
    expect(facts).toContain(PR_URL);
    expect(facts).toContain(SLACK_URL);
    expect(facts).toContain(INBOX_URL);
    expect(facts).toContain("main");
  });

  it("returns undefined task facts when there is nothing to report", () => {
    expect(makeServer().buildCloudTaskFacts()).toBeUndefined();
  });

  it("appends task facts to codex developer instructions", () => {
    const out = makeServer().buildCodexInstructions(
      "BASE",
      "<task_facts>x</task_facts>",
    );
    expect(out).toContain("BASE");
    expect(out).toContain("<task_facts>x</task_facts>");
  });
});
