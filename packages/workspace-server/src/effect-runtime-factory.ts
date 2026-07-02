import { Effect, type Layer, ManagedRuntime, Stream } from "effect";

/**
 * Builds a per-process Effect runtime from that process's service layer, plus
 * the helpers routers use to run service methods through it. Each host process
 * (Electron main, the workspace-server child) owns exactly one of these.
 *
 * A service tag is itself `Effect<Service, never, Service>`, so `runService`
 * resolves the service and runs the selected method in one step — routers never
 * write `Effect.flatMap(Tag, …)` by hand.
 */
export const makeEffectRuntime = <R, E>(layer: Layer.Layer<R, E>) => {
  const runtime = ManagedRuntime.make(layer);

  const runEffect = <A, EE>(
    effect: Effect.Effect<A, EE, R>,
    signal?: AbortSignal,
  ): Promise<A> => runtime.runPromise(effect, { signal });

  /** Resolve a service and run one of its Effect methods. */
  const runService = <I extends R, S, A, EE>(
    tag: Effect.Effect<S, never, I>,
    call: (service: S) => Effect.Effect<A, EE>,
    signal?: AbortSignal,
  ): Promise<A> => runEffect(Effect.flatMap(tag, call), signal);

  /** Resolve a service and stream one of its Stream members to a subscription. */
  async function* runServiceStream<I extends R, S, A, EE>(
    tag: Effect.Effect<S, never, I>,
    select: (service: S) => Stream.Stream<A, EE>,
  ): AsyncGenerator<A> {
    const stream = await runEffect(Effect.map(tag, select));
    yield* Stream.toAsyncIterable(stream);
  }

  /** Build the service graph so each service's scoped background work starts. */
  const start = (): void => {
    void runtime.context();
  };

  /** Interrupt every service fiber and release the runtime on shutdown. */
  const stop = (): Promise<void> => runtime.dispose();

  return { runEffect, runService, runServiceStream, start, stop };
};
