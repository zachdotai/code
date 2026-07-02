import { makeEffectRuntime } from "@posthog/workspace-server/effect-runtime-factory";
import { GitHubReleases } from "@posthog/workspace-server/services/github-releases/github-releases";
import { Layer } from "effect";

/**
 * Every converted Effect service's live layer goes here — the single place the
 * Electron main process composes its Effect services. Grows as more migrate.
 */
const AppLayer = Layer.mergeAll(GitHubReleases.Live);

export const { runService } = makeEffectRuntime(AppLayer);
