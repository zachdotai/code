import { describe, expect, it } from "vitest";
import {
  findConfidentMatch,
  findSimilarRepoSlugs,
  levenshteinDistance,
} from "./repo-slug-match";

describe("repo-slug-match", () => {
  it("computes case-insensitive levenshtein distance", () => {
    expect(
      levenshteinDistance("Brooker-Fam/nexus-game", "brooker-fam/nexus-games"),
    ).toBe(1);
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
  });

  it("finds similar repo slugs sorted by distance", () => {
    expect(
      findSimilarRepoSlugs("posthog/posthog-j", [
        "posthog/posthog-js",
        "posthog/posthog",
        "other/repo",
      ]),
    ).toEqual(["posthog/posthog-js", "posthog/posthog"]);
  });

  it("returns a confident same-owner match when unique", () => {
    expect(
      findConfidentMatch("Brooker-Fam/nexus-game", [
        "Brooker-Fam/nexus-games",
        "posthog/nexus-game",
      ]),
    ).toBe("Brooker-Fam/nexus-games");
  });

  it("does not return ambiguous or cross-owner matches", () => {
    expect(
      findConfidentMatch("Brooker-Fam/nexus-game", [
        "Brooker-Fam/nexus-games",
        "Brooker-Fam/nexus-gamer",
      ]),
    ).toBeNull();
    expect(
      findConfidentMatch("Brooker-Fam/nexus-game", ["other/nexus-games"]),
    ).toBeNull();
  });
});
