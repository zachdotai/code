import { getBackoffDelay } from "@posthog/shared";
import {
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Ref,
  Stream,
  SubscriptionRef,
} from "effect";
import type { ConnectivityStatusOutput } from "./schemas";

const CHECK_URLS = [
  "https://www.google.com/generate_204",
  "https://www.cloudflare.com/cdn-cgi/trace",
];
const CHECK_TIMEOUT_MS = 5_000;
const OFFLINE_CONFIRM_THRESHOLD = 2;
const MIN_POLL_INTERVAL_MS = 3_000;
const MAX_POLL_INTERVAL_MS = 10_000;
const ONLINE_POLL_INTERVAL_MS = 3_000;
const OFFLINE_BACKOFF_MULTIPLIER = 1.5;

class Unreachable extends Data.TaggedError("Unreachable")<
  Record<string, never>
> {}

const probe = (url: string) =>
  Effect.gen(function* () {
    // The Effect signal aborts the request on interruption (raced-loser or
    // timeout), so a losing probe doesn't linger.
    const response = yield* Effect.tryPromise({
      try: (signal) => fetch(url, { method: "HEAD", signal }),
      catch: () => new Unreachable({}),
    });
    if (!(response.ok || response.status === 204)) {
      return yield* Effect.fail(new Unreachable({}));
    }
  }).pipe(Effect.timeout(Duration.millis(CHECK_TIMEOUT_MS)));

// Reachable as soon as the first host responds; unreachable only when all fail.
const verifyOnline = Effect.raceAll(CHECK_URLS.map(probe)).pipe(
  Effect.as(true),
  Effect.orElseSucceed(() => false),
);

export interface ConnectivityState {
  readonly online: SubscriptionRef.SubscriptionRef<boolean>;
  readonly failures: Ref.Ref<number>;
}

const toStatus = (isOnline: boolean): ConnectivityStatusOutput => ({
  isOnline,
});

const setOnline = (state: ConnectivityState, next: boolean) =>
  Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(state.online);
    if (current === next) return; // avoid duplicate emissions to `.changes`
    yield* SubscriptionRef.set(state.online, next);
  });

/** One reachability check; flips state per the confirm-twice threshold. */
export const runCheck = (state: ConnectivityState) =>
  Effect.gen(function* () {
    const reachable = yield* verifyOnline;
    if (reachable) {
      yield* Ref.set(state.failures, 0);
      yield* setOnline(state, true);
      return;
    }
    const failures = yield* Ref.updateAndGet(state.failures, (n) => n + 1);
    if (failures >= OFFLINE_CONFIRM_THRESHOLD) {
      yield* setOnline(state, false);
    }
  });

// Online: steady cadence. Offline: back off, keyed on failures past the
// threshold (which is exactly the old "offline attempt" counter).
const pollInterval = (isOnline: boolean, failures: number): number =>
  isOnline
    ? ONLINE_POLL_INTERVAL_MS
    : getBackoffDelay(Math.max(0, failures - OFFLINE_CONFIRM_THRESHOLD), {
        initialDelayMs: MIN_POLL_INTERVAL_MS,
        maxDelayMs: MAX_POLL_INTERVAL_MS,
        multiplier: OFFLINE_BACKOFF_MULTIPLIER,
      });

const pollLoop = (state: ConnectivityState) =>
  Effect.forever(
    Effect.gen(function* () {
      yield* runCheck(state);
      const isOnline = yield* SubscriptionRef.get(state.online);
      const failures = yield* Ref.get(state.failures);
      yield* Effect.sleep(Duration.millis(pollInterval(isOnline, failures)));
    }),
  );

export class Connectivity extends Context.Service<Connectivity>()(
  "Connectivity",
  {
    make: Effect.gen(function* () {
      const state: ConnectivityState = {
        online: yield* SubscriptionRef.make(true),
        failures: yield* Ref.make(0),
      };

      // Poller is owned by the layer scope: starts on build, interrupted on
      // runtime dispose.
      yield* Effect.forkScoped(pollLoop(state));

      const getStatus = SubscriptionRef.get(state.online).pipe(
        Effect.map(toStatus),
      );
      return {
        getStatus,
        checkNow: runCheck(state).pipe(Effect.andThen(getStatus)),
        changes: SubscriptionRef.changes(state.online).pipe(
          Stream.map(toStatus),
        ),
      };
    }),
  },
) {
  static Live = Layer.effect(this, this.make);
}
