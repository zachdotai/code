import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import { GitHubReleases } from "@posthog/workspace-server/services/github-releases/github-releases";
import { listReleasesOutput } from "@posthog/workspace-server/services/github-releases/schemas";
import { Effect } from "effect";
import { runEffect } from "../effect-runtime";

export const githubReleasesRouter = router({
  list: publicProcedure.output(listReleasesOutput).query((opts) =>
    runEffect(
      Effect.flatMap(GitHubReleases, (service) => service.list()),
      opts.signal,
    ),
  ),
});
