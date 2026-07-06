/**
 * Fan-out messaging between same-origin windows/tabs of one app instance.
 * The sync leader broadcasts applied delta batches; followers apply them to
 * their in-memory pools (never to persistence — the leader owns writes).
 * Browser hosts implement this over `BroadcastChannel`. Payloads must be
 * structured-clone-safe (keep them JSON-safe by convention).
 */
export interface CrossWindowConnection {
  postMessage(data: unknown): void;
  subscribe(listener: (data: unknown) => void): () => void;
  close(): void;
}

export interface CrossWindowChannel {
  open(name: string): CrossWindowConnection;
}

export const CROSS_WINDOW_CHANNEL = Symbol.for(
  "posthog.platform.crossWindowChannel",
);
