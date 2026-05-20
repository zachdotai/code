import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Repository } from "../../db/repositories/repository-repository";
import { getWorktreeLocation } from "../settingsStore";
import type {
  GoalSpecBootstrapContext,
  RecordBootstrapHandoffInput,
} from "./schemas";
import { wrapUntrusted } from "./wrap-untrusted";

const MAX_FILE_PREVIEW_CHARS = 1200;
const MAX_REF_LABEL_CHARS = 256;
const REPO_REF_PART_RE = /^[A-Za-z0-9._-]+$/;

export function isValidRepoRef(ref: string): boolean {
  const parts = ref.split("/");
  if (parts.length !== 2) return false;
  for (const part of parts) {
    if (!part) return false;
    if (part === "." || part === "..") return false;
    if (!REPO_REF_PART_RE.test(part)) return false;
  }
  return true;
}

interface LocalRepoMatch {
  ref: string;
  path: string | null;
  remoteUrl: string | null;
  matchReason: string;
  cloneError: string | null;
  files: Array<{ path: string; summary: string }>;
}

interface LocalBootstrapOptions {
  cloneRepository?: (repoUrl: string, targetPath: string) => Promise<void>;
  registerFolder?: (
    folderPath: string,
    remoteUrl?: string,
  ) => Promise<{ path: string; remoteUrl: string | null } | null>;
}

export async function buildLocalBootstrapHandoff(
  nestId: string,
  context: GoalSpecBootstrapContext,
  repositories: Repository[],
  options: LocalBootstrapOptions = {},
): Promise<RecordBootstrapHandoffInput> {
  const matches = await Promise.all(
    context.repositories.map((ref) =>
      matchLocalRepository(ref, repositories, options),
    ),
  );

  return {
    nestId,
    taskId: `local-bootstrap:${nestId}`,
    repositories: context.repositories,
    primaryRepository: context.primaryRepository,
    handoffMarkdown: formatLocalHandoff(context, matches),
    outputJson: {
      mode: "local_bootstrap",
      repositories: matches.map((match) => ({
        ref: match.ref,
        path: match.path,
        remoteUrl: match.remoteUrl,
        matchReason: match.matchReason,
        files: match.files.map((file) => file.path),
      })),
    },
  };
}

async function matchLocalRepository(
  ref: string,
  repositories: Repository[],
  options: LocalBootstrapOptions,
): Promise<LocalRepoMatch> {
  const normalizedRef = normalize(ref);
  const repoName = ref.split("/").at(-1) ?? ref;
  const normalizedRepoName = normalize(repoName);

  const exactRemote = repositories.find((repo) =>
    normalize(repo.remoteUrl ?? "").includes(normalizedRef),
  );
  const byPath = repositories.find(
    (repo) => normalize(basename(repo.path)) === normalizedRepoName,
  );
  const match = exactRemote ?? byPath ?? null;

  if (!match) {
    const cloneTarget = cloneTargetForRepoRef(ref);
    const repoUrl = githubUrlForRepoRef(ref);
    if (cloneTarget && repoUrl && options.cloneRepository) {
      try {
        let cloned = false;
        if (!existsSync(cloneTarget.targetPath)) {
          mkdirSync(dirname(cloneTarget.targetPath), { recursive: true });
          await options.cloneRepository(repoUrl, cloneTarget.targetPath);
          cloned = true;
        }
        const registered =
          (await options.registerFolder?.(cloneTarget.targetPath, ref)) ?? null;
        const files = summarizeRepoFiles(cloneTarget.targetPath);
        return {
          ref,
          path: registered?.path ?? cloneTarget.targetPath,
          remoteUrl: registered?.remoteUrl ?? ref,
          matchReason: cloned
            ? "cloned into local PostHog Code storage"
            : "registered existing local PostHog Code clone path",
          cloneError: null,
          files,
        };
      } catch (error) {
        return {
          ref,
          path: null,
          remoteUrl: repoUrl,
          matchReason: "clone failed",
          cloneError: error instanceof Error ? error.message : String(error),
          files: [],
        };
      }
    }

    return {
      ref,
      path: null,
      remoteUrl: null,
      matchReason: cloneTarget
        ? "not found in local repository table"
        : "rejected: invalid repository slug",
      cloneError: null,
      files: [],
    };
  }

  const files = summarizeRepoFiles(match.path);
  return {
    ref,
    path: match.path,
    remoteUrl: match.remoteUrl ?? null,
    matchReason: exactRemote ? "matched remote URL" : "matched local path name",
    cloneError: null,
    files,
  };
}

function summarizeRepoFiles(
  path: string,
): Array<{ path: string; summary: string }> {
  const candidates = [
    "package.json",
    "pnpm-workspace.yaml",
    "turbo.json",
    "vite.config.ts",
    "next.config.js",
    "pyproject.toml",
    "README.md",
  ];

  return candidates
    .filter((relativePath) => existsSync(join(path, relativePath)))
    .map((relativePath) => ({
      path: relativePath,
      summary: summarizeFile(join(path, relativePath)),
    }));
}

function summarizeFile(filePath: string): string {
  try {
    const content = readFileSync(filePath, "utf8").trim();
    if (!content) return "(empty)";
    return content;
  } catch {
    return "(unreadable)";
  }
}

function formatLocalHandoff(
  context: GoalSpecBootstrapContext,
  matches: LocalRepoMatch[],
): string {
  const inspected = matches
    .map((match) => {
      const fileList =
        match.files.length > 0
          ? match.files.map((file) => `  - ${file.path}`).join("\n")
          : "  - no recognized project files found";
      return [
        `- ${match.ref}`,
        `  - local path: ${match.path ?? "not found"}`,
        `  - match: ${match.matchReason}`,
        `  - remote: ${match.remoteUrl ?? "unknown"}`,
        match.cloneError ? `  - clone error: ${match.cloneError}` : null,
        fileList,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const fileSummaries = matches
    .flatMap((match) =>
      match.files.map((file) => {
        const safeRef = match.ref.slice(0, MAX_REF_LABEL_CHARS);
        const safePath = file.path.slice(0, MAX_REF_LABEL_CHARS);
        const wrapped = wrapUntrusted(file.summary, {
          source: `file:${safeRef}/${safePath}`,
          maxChars: MAX_FILE_PREVIEW_CHARS,
        });
        return [`### ${safeRef} / ${safePath}`, wrapped].join("\n");
      }),
    )
    .join("\n\n");

  const unresolved = matches
    .filter((match) => !match.path || match.cloneError)
    .map((match) => `- ${match.ref}`)
    .join("\n");

  return [
    "## Hedgemony Bootstrap Context",
    "Local-only bootstrap handoff captured during nest creation. No cloud bootstrap task was started.",
    "",
    "## Repositories Inspected",
    inspected || "- none",
    "",
    "## Architecture And Dependencies",
    fileSummaries || "No local project files were available to summarize.",
    "",
    "## Cross-Repo Constraints",
    matches.length > 1
      ? "Multiple repositories were mentioned; treat follow-up hoglet creation as repo-scoped unless the final spec says the work is intentionally cross-repo."
      : "Single-repo bootstrap.",
    "",
    "## Risks And Unknowns",
    unresolved
      ? `Repos not available after local resolution:\n${unresolved}`
      : "No missing local repos detected.",
    "",
    "## Recommended Spec Updates",
    "Use the local file summaries above as grounding context, then ask the operator for any missing product requirements before spawning implementation hoglets.",
    "",
    "## Recommended Hoglet Seeds",
    matches
      .map(
        (match) =>
          `- ${match.ref}: start with a repo-scoped planning hoglet that reads the local tree, confirms package/test commands, and turns the nest spec into implementation tasks.`,
      )
      .join("\n") || "- none",
    "",
    "## Validation Plan",
    "Before implementation hoglets start, have each repo-scoped hoglet identify the repo's package manager, test command, lint/typecheck command, and relevant app entry points.",
    "",
    "## Original Bootstrap Prompt",
    context.prompt,
  ].join("\n");
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\.git$/, "");
}

function cloneTargetForRepoRef(ref: string): { targetPath: string } | null {
  if (!isValidRepoRef(ref)) return null;
  const [owner, repo] = ref.split("/");
  return {
    targetPath: join(getWorktreeLocation(), "repositories", owner, repo),
  };
}

function githubUrlForRepoRef(ref: string): string | null {
  if (!isValidRepoRef(ref)) return null;
  return `https://github.com/${ref}.git`;
}
