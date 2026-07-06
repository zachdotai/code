import { beforeEach, describe, expect, it, vi } from "vitest";

const execGh = vi.hoisted(() => vi.fn());
vi.mock("@posthog/git/gh", () => ({ execGh }));

import { GitService } from "./service";

const PR_URL = "https://github.com/o/r/pull/1";
const ok = (stdout: string) => ({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr = "boom") => ({ stdout: "", stderr, exitCode: 1 });

function checkRunsResponse(
  runs: Array<{
    name: string;
    status: string;
    conclusion?: string | null;
    details_url?: string | null;
    html_url?: string | null;
    started_at?: string | null;
  }>,
) {
  return JSON.stringify({ check_runs: runs });
}

describe("GitService.getPrMergeQueueStatus", () => {
  let git: GitService;
  beforeEach(() => {
    execGh.mockReset();
    git = new GitService();
  });

  it("returns the Trunk check run mapped to the schema", async () => {
    execGh
      .mockResolvedValueOnce(ok("abc123\n")) // head sha
      .mockResolvedValueOnce(
        ok(
          checkRunsResponse([
            { name: "build", status: "completed", conclusion: "success" },
            {
              name: "Trunk Merge Queue (main)",
              status: "in_progress",
              conclusion: null,
              details_url: "https://app.trunk.io/x",
              started_at: "2026-01-01T00:00:00Z",
            },
          ]),
        ),
      );

    const result = await git.getPrMergeQueueStatus(PR_URL);
    expect(result).toEqual({
      status: "in_progress",
      conclusion: null,
      detailsUrl: "https://app.trunk.io/x",
      name: "Trunk Merge Queue (main)",
    });

    // First call resolves the head sha; second reads that commit's check runs.
    expect(execGh.mock.calls[0][0]).toEqual([
      "api",
      "repos/o/r/pulls/1",
      "--jq",
      ".head.sha",
    ]);
    expect(execGh.mock.calls[1][0]).toEqual([
      "api",
      "repos/o/r/commits/abc123/check-runs?per_page=100",
    ]);
  });

  it("returns null when there is no Trunk check run", async () => {
    execGh
      .mockResolvedValueOnce(ok("abc123"))
      .mockResolvedValueOnce(
        ok(checkRunsResponse([{ name: "build", status: "completed" }])),
      );
    expect(await git.getPrMergeQueueStatus(PR_URL)).toBeNull();
  });

  it("picks the most recently started Trunk run", async () => {
    execGh.mockResolvedValueOnce(ok("abc123")).mockResolvedValueOnce(
      ok(
        checkRunsResponse([
          {
            name: "Trunk Merge Queue (main)",
            status: "completed",
            conclusion: "failure",
            started_at: "2026-01-01T00:00:00Z",
          },
          {
            name: "Trunk Merge Queue (main)",
            status: "queued",
            conclusion: null,
            started_at: "2026-01-02T00:00:00Z",
          },
        ]),
      ),
    );
    const result = await git.getPrMergeQueueStatus(PR_URL);
    expect(result?.status).toBe("queued");
  });

  it("falls back to html_url when details_url is absent", async () => {
    execGh.mockResolvedValueOnce(ok("abc123")).mockResolvedValueOnce(
      ok(
        checkRunsResponse([
          {
            name: "Trunk Merge Queue (main)",
            status: "queued",
            conclusion: null,
            details_url: null,
            html_url: "https://github.com/o/r/runs/1",
            started_at: "2026-01-01T00:00:00Z",
          },
        ]),
      ),
    );
    const result = await git.getPrMergeQueueStatus(PR_URL);
    expect(result?.detailsUrl).toBe("https://github.com/o/r/runs/1");
  });

  it("returns null for a non-PR URL without calling gh", async () => {
    expect(
      await git.getPrMergeQueueStatus("https://github.com/o/r/issues/1"),
    ).toBeNull();
    expect(execGh).not.toHaveBeenCalled();
  });

  it("returns null when the sha lookup fails", async () => {
    execGh.mockResolvedValueOnce(fail());
    expect(await git.getPrMergeQueueStatus(PR_URL)).toBeNull();
  });

  it("returns null when the check-runs call fails", async () => {
    execGh.mockResolvedValueOnce(ok("abc123")).mockResolvedValueOnce(fail());
    expect(await git.getPrMergeQueueStatus(PR_URL)).toBeNull();
  });
});

describe("GitService.updatePrByUrl merge-queue actions", () => {
  let git: GitService;
  beforeEach(() => {
    execGh.mockReset();
    git = new GitService();
  });

  it("posts '/trunk merge' for the merge-queue action", async () => {
    execGh.mockResolvedValueOnce(ok("commented"));
    const result = await git.updatePrByUrl(PR_URL, "merge-queue");
    expect(result.success).toBe(true);
    expect(execGh).toHaveBeenCalledWith([
      "pr",
      "comment",
      "1",
      "--repo",
      "o/r",
      "--body",
      "/trunk merge",
    ]);
  });

  it("posts '/trunk cancel' for the merge-queue-cancel action", async () => {
    execGh.mockResolvedValueOnce(ok("commented"));
    await git.updatePrByUrl(PR_URL, "merge-queue-cancel");
    expect(execGh).toHaveBeenCalledWith([
      "pr",
      "comment",
      "1",
      "--repo",
      "o/r",
      "--body",
      "/trunk cancel",
    ]);
  });

  it("surfaces a gh failure as an unsuccessful result", async () => {
    execGh.mockResolvedValueOnce(fail("no write access"));
    const result = await git.updatePrByUrl(PR_URL, "merge-queue");
    expect(result).toEqual({ success: false, message: "no write access" });
  });

  it("still routes lifecycle actions through the gh pr subcommand", async () => {
    execGh.mockResolvedValueOnce(ok("closed"));
    await git.updatePrByUrl(PR_URL, "close");
    expect(execGh).toHaveBeenCalledWith(["pr", "close", "1", "--repo", "o/r"]);
  });
});
