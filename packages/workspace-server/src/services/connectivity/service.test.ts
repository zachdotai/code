import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "@effect/vitest";
import { Effect, Ref, SubscriptionRef } from "effect";
import { type ConnectivityState, runCheck } from "./service";

const ok = (status = 200) => ({ ok: true, status }) as unknown as Response;
const notOk = (status = 500) => ({ ok: false, status }) as unknown as Response;

const makeState = Effect.gen(function* () {
  const state: ConnectivityState = {
    online: yield* SubscriptionRef.make(true),
    failures: yield* Ref.make(0),
  };
  return state;
});

const isOnline = (state: ConnectivityState) =>
  SubscriptionRef.get(state.online);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ok(204));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("connectivity check logic", () => {
  it.effect("goes online when a HEAD probe succeeds", () =>
    Effect.gen(function* () {
      fetchMock.mockResolvedValue(ok(204));
      const state = yield* makeState;
      yield* runCheck(state);
      expect(yield* isOnline(state)).toBe(true);
    }),
  );

  it.effect(
    "stays online after a single failed check (needs confirmation)",
    () =>
      Effect.gen(function* () {
        fetchMock.mockRejectedValue(new Error("offline"));
        const state = yield* makeState;
        yield* runCheck(state); // one dropped probe is a blip, not an outage
        expect(yield* isOnline(state)).toBe(true);
      }),
  );

  it.effect("goes offline only after consecutive failed checks", () =>
    Effect.gen(function* () {
      fetchMock.mockRejectedValue(new Error("offline"));
      const state = yield* makeState;
      yield* runCheck(state); // 1st failure
      expect(yield* isOnline(state)).toBe(true);
      yield* runCheck(state); // 2nd failure -> confirmed offline
      expect(yield* isOnline(state)).toBe(false);
    }),
  );

  it.effect("recovers to online after a successful check", () =>
    Effect.gen(function* () {
      fetchMock.mockRejectedValue(new Error("offline"));
      const state = yield* makeState;
      yield* runCheck(state);
      yield* runCheck(state); // confirmed offline

      fetchMock.mockResolvedValue(ok(204));
      yield* runCheck(state);
      expect(yield* isOnline(state)).toBe(true);
    }),
  );

  it.effect("accepts a 200 response as reachable", () =>
    Effect.gen(function* () {
      fetchMock.mockResolvedValue(ok(200));
      const state = yield* makeState;
      yield* runCheck(state);
      expect(yield* isOnline(state)).toBe(true);
    }),
  );

  it.effect("treats a non-ok, non-204 response as a failed probe", () =>
    Effect.gen(function* () {
      fetchMock.mockResolvedValue(notOk(500));
      const state = yield* makeState;
      yield* runCheck(state);
      yield* runCheck(state);
      expect(yield* isOnline(state)).toBe(false);
    }),
  );

  it.effect("stays online when at least one host is reachable", () =>
    Effect.gen(function* () {
      fetchMock.mockImplementation((url: string) =>
        url.includes("google")
          ? Promise.reject(new Error("blocked"))
          : Promise.resolve(ok(204)),
      );
      const state = yield* makeState;
      yield* runCheck(state);
      expect(yield* isOnline(state)).toBe(true);
    }),
  );
});
