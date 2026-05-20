import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "../../db/repositories/repository-repository";
import type { GoalSpecBootstrapContext } from "./schemas";

let worktreeLocation = "";

vi.mock("../settingsStore", () => ({
  getWorktreeLocation: () => worktreeLocation,
}));

import { buildLocalBootstrapHandoff } from "./local-bootstrap-handoff";

function makeContext(
  repositories: string[] = ["posthog/posthog"],
): GoalSpecBootstrapContext {
  return {
    mode: "agent_bootstrap",
    repositories,
    primaryRepository: repositories[0] ?? null,
    prompt: "Inspect the repo and produce a handoff.",
    handoffInstructions: "Persist the handoff.",
  };
}

function makeRepository(overrides: Partial<Repository> = {}): Repository {
  return {
    id: "repo-1",
    path: join(worktreeLocation, "posthog"),
    remoteUrl: "https://github.com/posthog/posthog.git",
    lastAccessedAt: null,
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildLocalBootstrapHandoff", () => {
  beforeEach(() => {
    worktreeLocation = mkdtempSync(join(tmpdir(), "hedgemony-bootstrap-"));
  });

  afterEach(() => {
    rmSync(worktreeLocation, { recursive: true, force: true });
  });

  it("matches an existing local repository by remote and summarizes project files", async () => {
    const repoPath = join(worktreeLocation, "posthog");
    mkdirSync(repoPath, { recursive: true });
    writeFileSync(
      join(repoPath, "package.json"),
      JSON.stringify({ name: "posthog", scripts: { test: "vitest" } }),
    );

    const handoff = await buildLocalBootstrapHandoff("nest-1", makeContext(), [
      makeRepository({ path: repoPath }),
    ]);

    expect(handoff.taskId).toBe("local-bootstrap:nest-1");
    expect(handoff.handoffMarkdown).toContain("matched remote URL");
    expect(handoff.handoffMarkdown).toContain(
      "### posthog/posthog / package.json",
    );
    expect(handoff.handoffMarkdown).toContain('"test":"vitest"');
    expect(handoff.outputJson).toMatchObject({
      mode: "local_bootstrap",
      repositories: [
        {
          ref: "posthog/posthog",
          path: repoPath,
          matchReason: "matched remote URL",
          files: ["package.json"],
        },
      ],
    });
  });

  it("clones and registers an org/repo ref that is not already local", async () => {
    const cloneRepository = vi.fn(
      async (_repoUrl: string, targetPath: string) => {
        mkdirSync(targetPath, { recursive: true });
        writeFileSync(join(targetPath, "README.md"), "# Nexus Game\n");
      },
    );
    const registerFolder = vi.fn(
      async (folderPath: string, remoteUrl?: string) => ({
        path: folderPath,
        remoteUrl: remoteUrl ?? null,
      }),
    );

    const handoff = await buildLocalBootstrapHandoff(
      "nest-1",
      makeContext(["Brooker-Fam/nexus-game"]),
      [],
      { cloneRepository, registerFolder },
    );

    const expectedTarget = join(
      worktreeLocation,
      "repositories",
      "Brooker-Fam",
      "nexus-game",
    );
    expect(cloneRepository).toHaveBeenCalledWith(
      "https://github.com/Brooker-Fam/nexus-game.git",
      expectedTarget,
    );
    expect(registerFolder).toHaveBeenCalledWith(
      expectedTarget,
      "Brooker-Fam/nexus-game",
    );
    expect(handoff.handoffMarkdown).toContain(
      "cloned into local PostHog Code storage",
    );
    expect(handoff.handoffMarkdown).toContain(
      "### Brooker-Fam/nexus-game / README.md",
    );
    expect(handoff.outputJson).toMatchObject({
      repositories: [
        {
          ref: "Brooker-Fam/nexus-game",
          path: expectedTarget,
          remoteUrl: "Brooker-Fam/nexus-game",
          matchReason: "cloned into local PostHog Code storage",
          files: ["README.md"],
        },
      ],
    });
  });

  it("records clone failures as unresolved context instead of throwing", async () => {
    const cloneRepository = vi.fn(async () => {
      throw new Error("permission denied");
    });

    const handoff = await buildLocalBootstrapHandoff(
      "nest-1",
      makeContext(["Brooker-Fam/private-game"]),
      [],
      { cloneRepository },
    );

    expect(handoff.handoffMarkdown).toContain("match: clone failed");
    expect(handoff.handoffMarkdown).toContain("clone error: permission denied");
    expect(handoff.handoffMarkdown).toContain(
      "Repos not available after local resolution:\n- Brooker-Fam/private-game",
    );
    expect(handoff.outputJson).toMatchObject({
      repositories: [
        {
          ref: "Brooker-Fam/private-game",
          path: null,
          matchReason: "clone failed",
        },
      ],
    });
  });

  it("bounds file previews in the handoff", async () => {
    const repoPath = join(worktreeLocation, "posthog");
    mkdirSync(repoPath, { recursive: true });
    writeFileSync(join(repoPath, "README.md"), "a".repeat(1300));

    const handoff = await buildLocalBootstrapHandoff("nest-1", makeContext(), [
      makeRepository({ path: repoPath }),
    ]);

    // File content is wrapped in an <untrusted_signal> envelope and truncated
    // to MAX_FILE_PREVIEW_CHARS with a length marker — never paste the raw
    // file content directly into the LLM prompt.
    expect(handoff.handoffMarkdown).toContain(
      '<untrusted_signal source="file:',
    );
    expect(handoff.handoffMarkdown).toContain("a".repeat(1200));
    expect(handoff.handoffMarkdown).toContain(
      "[truncated, original length: 1300 chars]",
    );
    expect(handoff.handoffMarkdown).not.toContain("a".repeat(1300));
  });
});
