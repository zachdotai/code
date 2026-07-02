import { GitHubReleases } from "@posthog/workspace-server/services/github-releases/github-releases";
import { type Effect, Layer, ManagedRuntime } from "effect";

/**
 * Every converted Effect service's live layer goes here. This is the single
 * place the host's Effect services are composed; it grows as more services
 * migrate off Inversify.
 */
const AppLayer = Layer.mergeAll(GitHubReleases.Live);

/** One shared runtime for the whole host process — services are singletons. */
const appRuntime = ManagedRuntime.make(AppLayer);

/**
 * Runs an Effect through the shared host runtime and hands tRPC back a Promise.
 * The tRPC request's abort signal is forwarded, so a cancelled request
 * interrupts the fiber and releases its resources.
 */
export const runEffect = <A, E>(
  effect: Effect.Effect<A, E, Layer.Success<typeof AppLayer>>,
  signal?: AbortSignal,
): Promise<A> => appRuntime.runPromise(effect, { signal });
