export interface ForwardedSubscriptionHandlers<T> {
  onData: (value: T) => void;
  onError: (error: unknown) => void;
  onComplete: () => void;
}

/**
 * Bridge a tRPC client subscription into an async generator, so main can
 * re-serve a node-host subscription to its own tRPC callers (the renderer's
 * electron-trpc path, until it talks to the node host directly). Ends when the
 * upstream completes or errors, or when the downstream consumer aborts.
 */
export async function* forwardSubscription<T>(
  subscribe: (handlers: ForwardedSubscriptionHandlers<T>) => {
    unsubscribe: () => void;
  },
  signal: AbortSignal | undefined,
): AsyncGenerator<T> {
  const queue: T[] = [];
  let done = false;
  let failure: unknown = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };

  const subscription = subscribe({
    onData: (value) => {
      queue.push(value);
      notify();
    },
    onError: (error) => {
      failure = error;
      done = true;
      notify();
    },
    onComplete: () => {
      done = true;
      notify();
    },
  });

  const onAbort = () => {
    done = true;
    notify();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      while (queue.length > 0) {
        yield queue.shift() as T;
      }
      if (done || signal?.aborted) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    if (failure !== null && !signal?.aborted) {
      throw failure;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    subscription.unsubscribe();
  }
}
