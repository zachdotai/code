import gitUrlParse from "git-url-parse";

/**
 * Parse an `owner/name` slug from a git remote URL. Thin wrapper over
 * `git-url-parse`, which handles scp-like SSH (`git@host:owner/name.git`) and
 * URL forms (`https://`, `ssh://`, `git://`, ...) host-agnostically. Anything
 * that doesn't resolve to exactly two path segments — nested paths (GitLab
 * subgroups, where the library packs the extra segment into `owner`), local
 * paths, or unparseable input — returns null so callers omit the value rather
 * than emit a malformed slug.
 */
export function parseRepoSlug(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const { owner, name } = gitUrlParse(url.trim());
    if (!owner || !name || owner.includes("/")) return null;
    return `${owner}/${name}`;
  } catch {
    return null;
  }
}
