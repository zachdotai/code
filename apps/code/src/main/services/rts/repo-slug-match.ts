export function levenshteinDistance(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);

  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost,
      );
    }
    previous = current;
  }

  return previous[right.length] ?? 0;
}

export function findSimilarRepoSlugs(
  target: string,
  candidates: string[],
  maxDistance = 3,
): string[] {
  return candidates
    .map((candidate) => ({
      candidate,
      distance: levenshteinDistance(target, candidate),
    }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort(
      (a, b) =>
        a.distance - b.distance || a.candidate.localeCompare(b.candidate),
    )
    .map(({ candidate }) => candidate);
}

export function findConfidentMatch(
  target: string,
  candidates: string[],
): string | null {
  const parsedTarget = parseRepoSlug(target);
  if (!parsedTarget) return null;

  const matches = candidates.filter((candidate) => {
    const parsedCandidate = parseRepoSlug(candidate);
    if (!parsedCandidate) return false;
    if (parsedCandidate.owner !== parsedTarget.owner) return false;
    return levenshteinDistance(parsedTarget.repo, parsedCandidate.repo) <= 2;
  });

  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function parseRepoSlug(slug: string): { owner: string; repo: string } | null {
  const [owner, repo, ...rest] = slug.split("/");
  if (!owner || !repo || rest.length > 0) return null;
  return { owner: owner.toLowerCase(), repo: repo.toLowerCase() };
}
