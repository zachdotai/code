import { execGh } from "@posthog/git/gh";
import type {
  GithubActivityItem,
  GithubActivitySummary,
  GithubActivityType,
} from "@shared/types/work-projects";
import { injectable } from "inversify";
import { logger } from "../../utils/logger";

const log = logger.scope("github-activity-service");

const RECENT_LIMIT = 10;
const PER_TYPE_LIMIT = 50;

interface FetchActivityParams {
  repo: { owner: string; name: string };
  enabledTypes: GithubActivityType[];
  windowDays: number;
}

interface GhPrJson {
  number: number;
  title: string;
  url: string;
  mergedAt?: string | null;
  createdAt?: string;
  author?: { login?: string | null; name?: string | null } | null;
}

interface GhIssueJson {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  author?: { login?: string | null; name?: string | null } | null;
}

interface GhReleaseJson {
  name?: string | null;
  tagName?: string | null;
  publishedAt?: string | null;
  url?: string | null;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function authorOf(
  author: { login?: string | null; name?: string | null } | null | undefined,
): string | undefined {
  if (!author) return undefined;
  return author.login || author.name || undefined;
}

function emptyCounts(): GithubActivitySummary["counts"] {
  return { pr_merged: 0, pr_opened: 0, issue_opened: 0, release: 0 };
}

@injectable()
export class GithubActivityService {
  /** Fetch a fresh summary for the given repo + config. Always returns a
   *  summary — on error, `error` is set and counts are zero. */
  public async fetchActivity(
    params: FetchActivityParams,
  ): Promise<GithubActivitySummary> {
    const { repo, enabledTypes, windowDays } = params;
    const fetchedAt = new Date().toISOString();
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const sinceDate = toIsoDate(since);
    const sinceMs = since.getTime();
    const repoArg = `${repo.owner}/${repo.name}`;

    const counts = emptyCounts();
    const items: GithubActivityItem[] = [];

    const typeSet = new Set(enabledTypes);

    // Auth probe — surface a friendly message before fanning out gh calls.
    const authResult = await execGh(["auth", "status"]);
    if (authResult.exitCode !== 0) {
      const errText = authResult.stderr || authResult.error || "";
      if (errText.includes("not found") || authResult.exitCode === 127) {
        return {
          fetchedAt,
          windowDays,
          counts,
          recent: [],
          error:
            "The `gh` CLI is not installed. Install it from https://cli.github.com.",
        };
      }
      return {
        fetchedAt,
        windowDays,
        counts,
        recent: [],
        error: "Not signed in to GitHub. Run `gh auth login` in a terminal.",
      };
    }

    try {
      if (typeSet.has("pr_merged")) {
        const merged = await this.fetchPrs(repoArg, "merged", sinceDate);
        for (const pr of merged) {
          const when = pr.mergedAt;
          if (!when) continue;
          if (new Date(when).getTime() < sinceMs) continue;
          counts.pr_merged += 1;
          items.push({
            id: `pr-merged-${pr.number}`,
            type: "pr_merged",
            title: pr.title,
            url: pr.url,
            actor: authorOf(pr.author),
            when,
          });
        }
      }

      if (typeSet.has("pr_opened")) {
        const opened = await this.fetchPrs(repoArg, "open", sinceDate);
        for (const pr of opened) {
          const when = pr.createdAt;
          if (!when) continue;
          if (new Date(when).getTime() < sinceMs) continue;
          counts.pr_opened += 1;
          items.push({
            id: `pr-opened-${pr.number}`,
            type: "pr_opened",
            title: pr.title,
            url: pr.url,
            actor: authorOf(pr.author),
            when,
          });
        }
      }

      if (typeSet.has("issue_opened")) {
        const issues = await this.fetchIssues(repoArg, sinceDate);
        for (const iss of issues) {
          const when = iss.createdAt;
          if (!when) continue;
          if (new Date(when).getTime() < sinceMs) continue;
          counts.issue_opened += 1;
          items.push({
            id: `issue-${iss.number}`,
            type: "issue_opened",
            title: iss.title,
            url: iss.url,
            actor: authorOf(iss.author),
            when,
          });
        }
      }

      if (typeSet.has("release")) {
        const releases = await this.fetchReleases(repoArg);
        for (const rel of releases) {
          const when = rel.publishedAt;
          if (!when) continue;
          if (new Date(when).getTime() < sinceMs) continue;
          counts.release += 1;
          items.push({
            id: `release-${rel.tagName ?? rel.name ?? when}`,
            type: "release",
            title: rel.name || rel.tagName || "Release",
            url: rel.url || `https://github.com/${repoArg}/releases`,
            when,
          });
        }
      }
    } catch (error) {
      log.warn("github activity fetch failed", { repo: repoArg, error });
      const message =
        error instanceof Error ? error.message : "Failed to fetch activity";
      return {
        fetchedAt,
        windowDays,
        counts,
        recent: [],
        error: message,
      };
    }

    items.sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
    const recent = items.slice(0, RECENT_LIMIT);

    return { fetchedAt, windowDays, counts, recent };
  }

  private async fetchPrs(
    repoArg: string,
    state: "merged" | "open",
    sinceDate: string,
  ): Promise<GhPrJson[]> {
    const searchKey = state === "merged" ? "merged" : "created";
    const args = [
      "pr",
      "list",
      "--repo",
      repoArg,
      "--state",
      state,
      "--search",
      `${searchKey}:>=${sinceDate}`,
      "--json",
      "number,title,url,mergedAt,createdAt,author",
      "--limit",
      String(PER_TYPE_LIMIT),
    ];
    const result = await execGh(args);
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr.trim() ||
          result.error ||
          `gh pr list (${state}) failed for ${repoArg}`,
      );
    }
    try {
      return JSON.parse(result.stdout) as GhPrJson[];
    } catch {
      return [];
    }
  }

  private async fetchIssues(
    repoArg: string,
    sinceDate: string,
  ): Promise<GhIssueJson[]> {
    const args = [
      "issue",
      "list",
      "--repo",
      repoArg,
      "--state",
      "all",
      "--search",
      `created:>=${sinceDate}`,
      "--json",
      "number,title,url,createdAt,author",
      "--limit",
      String(PER_TYPE_LIMIT),
    ];
    const result = await execGh(args);
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr.trim() ||
          result.error ||
          `gh issue list failed for ${repoArg}`,
      );
    }
    try {
      return JSON.parse(result.stdout) as GhIssueJson[];
    } catch {
      return [];
    }
  }

  private async fetchReleases(repoArg: string): Promise<GhReleaseJson[]> {
    const args = [
      "release",
      "list",
      "--repo",
      repoArg,
      "--limit",
      "20",
      "--json",
      "name,tagName,publishedAt,url",
    ];
    const result = await execGh(args);
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr.trim() ||
          result.error ||
          `gh release list failed for ${repoArg}`,
      );
    }
    try {
      return JSON.parse(result.stdout) as GhReleaseJson[];
    } catch {
      return [];
    }
  }
}
