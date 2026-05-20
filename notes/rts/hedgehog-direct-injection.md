# Hedgehog → Hoglet Direct Injection

## Problem

The renderer's SDK session-to-cloud-task connection currently serves two
unrelated roles:

1. **Observation.** The operator opens a hoglet's task tab; the renderer
   establishes a live ACP session to the cloud task and streams events
   into `useSessionStore`. The operator watches the agent's tool calls,
   messages, and permission requests in real time.
2. **Hedgehog message delivery.** The renderer-attached SDK session is
   the *only* path through which `message_hoglet` from the hedgehog can
   reach a running hoglet. `useHedgemonyPromptRouter` checks
   `session?.status === "connected"` and, if so, calls
   `sendPromptToAgent(taskId, prompt)` which dispatches through the
   socket.

These should be independent. They aren't, and the consequences are
visible to the operator:

- A hoglet running in a tab the operator has never opened is
  unreachable to the hedgehog. Every `message_hoglet` to that hoglet is
  suppressed (post-router-fix) or wastefully spawns a follow-up
  (pre-router-fix). Neither delivers the message.
- The operator's choice to attach (or not) silently controls whether
  the hedgehog's autonomous orchestration can advance. Attaching to
  "just take a look" implicitly opts the operator into being the
  courier for every pending probe to that hoglet.
- The recent queue-and-drain attempt (now reverted) made delivery
  reliable but cemented the conflation: queued messages flooded in
  the moment the operator attached, surfacing the architecture's
  shape as a UX wart.

The mental model the operator expects — and the model hedgemony
implicitly promises — is that the hedgehog can orchestrate hoglets
autonomously regardless of which tabs are open in the renderer. The
current implementation does not honor that promise.

## Goal

Decouple hedgehog → hoglet message delivery from renderer-attached
SDK sessions. Main owns delivery; the renderer's job is observation
only. `message_hoglet` from the hedgehog reaches a running hoglet
whether or not any operator has its task tab open.

## Non-goals

- Changing the renderer's session-store / ACP-socket plumbing for
  observation. That stays as-is.
- Removing the existing `spawn_follow_up` route for external feedback
  (`pr_review`, `ci`) directed at terminated hoglets — that's the
  right answer there.
- Removing operator visibility of hedgehog messages. They should still
  appear in the agent's conversation when the operator does attach, so
  the operator can see what the hedgehog has been telling its hoglets.

## Approach

Main-side direct injection: when the hedgehog calls `message_hoglet`,
`FeedbackRoutingService.routeHedgehogPrompt` calls
`CloudTaskClient.injectPrompt(taskId, taskRunId, prompt)` directly.
That method POSTs a `user_message` JSON-RPC command to the cloud run's
existing `/command/` endpoint, matching the endpoint the renderer uses
for connected cloud sessions. The renderer is removed from the loop for
hedgehog-source events entirely.

For non-hedgehog sources (`pr_review`, `ci`, `issue`), the existing
renderer-mediated routing stays in place — those routes deliberately
fall back to `spawnFollowUpHoglet` when the original run has ended,
which is correct behavior for feedback on closed hoglets.

The `useHedgemonyPromptRouter` hook collapses to a much smaller
surface: it only handles the non-hedgehog feedback paths, since
hedgehog events no longer flow through the renderer.

## Open questions (resolve before implementation)

1. **Does the cloud-task API expose a main-callable
   message-injection endpoint?** Resolved: the existing
   `/api/projects/{project}/tasks/{task}/runs/{run}/command/`
   endpoint accepts authenticated JSON-RPC `user_message` commands from
   main using the same auth plumbing as other cloud task calls.

2. **What does the cloud-task user-vs-bot identity look like for a
   main-originated injection?** The existing path injects as the
   operator (who is connected via the renderer). When main injects
   directly without a renderer socket, who is the "author" of the
   injected message? Hedgemony probably wants this surfaced as
   "system" or "hedgehog" rather than as the operator — otherwise
   operator-attached tabs will show hedgehog messages styled as
   operator messages.

3. **What happens to messages directed at a hoglet whose cloud run
   has terminated between the hedgehog's emission and main's POST?**
   The cloud-side will likely reject. We should fall back to the
   existing `spawn_follow_up` route in that case (same outcome as
   pr_review / ci feedback to a closed hoglet).

4. **Concurrency.** Multiple hedgehog ticks could fire `message_hoglet`
   close together (different toolCallIds, same hoglet). Each becomes
   an independent POST. The cloud-task agent processes them as
   distinct prompts in order. No new locking needed if the cloud-side
   serializes; otherwise we may need a per-hoglet main-side semaphore.

## Implementation sketch

### 1. `CloudTaskClient.injectPrompt`

**File:** `apps/code/src/main/services/hedgemony/cloud-task-client.ts`

Add a new method:

```ts
async injectPrompt(input: {
  taskId: string;
  taskRunId: string;
  prompt: string;
  /** Source identifier — hedgemony surfaces this so the cloud-side
   *  can label/style the message as hedgehog-authored rather than
   *  operator-authored. */
  authoredBy: "hedgehog";
}): Promise<{ accepted: true } | { accepted: false; reason: string }>;
```

Implementation POSTs to
`/api/projects/{project}/tasks/{task}/runs/{run}/command/` with a
JSON-RPC body like
`{ "jsonrpc": "2.0", "method": "user_message", "params": { "content": "..." } }`.
The fetch is authenticated via the existing `auth.authenticatedFetch`
plumbing already used by `createTaskRun` and `getTaskWithLatestRun`.

Error handling:
- 400 / 404 → no active run/session available → return
  `{ accepted: false, reason: "run_unavailable" }`.
- JSON-RPC `error` → return `{ accepted: false, reason: "rejected" }`
  with the command error message.
- Network or unsafe response shape → throw; the caller records a failed
  route and the hedgehog can retry on a later tick if still useful.
- JSON-RPC ids use a fresh UUID so same-millisecond hedgehog messages
  do not share telemetry/correlation ids.

### 2. `FeedbackRoutingService.routeHedgehogPrompt` rewires

**File:** `apps/code/src/main/services/hedgemony/feedback-routing-service.ts`

`routeHedgehogPrompt` no longer emits renderer events for active
hedgehog messages. It now:

- Uses the `latestRunId` and `targetRunStatus` already captured in the
  hedgehog tick context.
- Directly injects only when the target run is `in_progress`.
- On `run_unavailable`, re-reads the task's latest run once. If the
  latest run is a different `in_progress` run, it retries injection
  there; if the latest run is terminal, it emits the terminal follow-up
  fallback instead.
- Preserves the narrow renderer fallback for terminal
  `completed` / `failed` / `cancelled` targets, where spawning a
  follow-up remains the right behavior.
- Records `failed` for queued, not-started, unknown, unavailable, or
  rejected runs so the hedgehog knows that specific message was not
  delivered.

The renderer-fallback path is intentionally narrow: it fires only for
terminal targets where a follow-up spawn is the right answer. The
renderer router's existing logic for that case (`spawn_follow_up`)
handles it.

### 3. `useHedgemonyPromptRouter` simplification

**File:** `apps/code/src/renderer/features/hedgemony/hooks/useHedgemonyPromptRouter.ts`

Most hedgehog-source events no longer reach the renderer. The only
ones that do are the run-terminated fallbacks (and only for hedgehog
source). The hook keeps handling pr_review / ci / issue feedback as
before.

Either:
- Keep the existing router decision logic but expect `source ===
  "hedgehog"` only with a terminated target run (the
  `suppress_hedgehog_follow_up` branch becomes dead code and is
  removed).
- Or remove all hedgehog-source handling from the hook and rely on
  main to only emit when fallback is the answer. The hook checks
  `payload.source === "hedgehog"` and assumes spawn-follow-up.

Cleaner: the second option. Hedgehog events that reach the renderer are
already fallback events, so the router never tries to inject them into a
possibly stale connected session:

```ts
export function resolveHedgemonyPromptRoute(input: {
  payload: InjectPromptEventPayload;
  sessionStatus: string | null | undefined;
}): PromptRoute {
  if (input.payload.source === "hedgehog") {
    return input.payload.nestId ? "spawn_follow_up" : "failed";
  }
  if (input.sessionStatus === "connected") return "inject";
  return input.payload.nestId ? "spawn_follow_up" : "failed";
}
```

No more `suppress_hedgehog_follow_up`. `targetRunStatus` remains on
the payload for the narrow terminal fallback path.

### 4. System-prompt cleanup

**File:** `apps/code/src/main/services/hedgemony/hedgehog-prompts.ts`

Remove the short-term "task tab not open" Operational Posture clause
once direct injection is in place. The hedgehog may still see older
history with that wording, but new failed routes should describe the
cloud run as not accepting messages.

### 5. Tests

- `cloud-task-client.test.ts`: cover `injectPrompt` happy path,
  400 / 404 → `{ accepted: false, reason: "run_unavailable" }`,
  and JSON-RPC command rejection.
- `feedback-routing-service.test.ts`: cover three branches of
  `routeHedgehogPrompt` — direct-inject success, terminal fallback
  to emit, non-accepting run failure, and one-shot stale latest-run
  recovery.
- `promptRouting.test.ts`: simplify since `suppress_hedgehog_follow_up`
  is gone.
- `useHedgemonyPromptRouter.test.ts`: remove the
  suppress-branch tests; verify pr_review / ci paths unchanged.
- Manual / e2e: spawn a nest with a hoglet, do NOT attach its tab,
  have the hedgehog message it via operator chat ("ask hoglet X what
  it's working on"). Verify the message lands in the hoglet's
  conversation (visible when you later attach the tab) without
  attachment being a precondition.

## Cloud-side prerequisites

None for the first version. The existing cloud run `/command/`
endpoint is enough for main-side text injection. A future backend
improvement could add first-class `authored_by: "hedgehog"` metadata
so attached renderer sessions can style hedgehog-authored messages
separately from operator-authored prompts.

## Out of scope

- Persistent durable queue for cases where the cloud-side is briefly
  unavailable (5xx, network blip). In-tick retry handled by the
  hedgehog's own tool-error recovery; multi-tick durability is a
  follow-up if observed reliability is a problem.
- Multi-attempt recovery for repeated latest-run churn. The direct
  injection path does one fresh latest-run read and one retry, then
  records a failed route if the cloud run still cannot accept the
  message.
- Operator-authored direct injection from outside the renderer (e.g.,
  CLI command). Not a current need; main's `injectPrompt` is
  hedgemony-only.
- Backfilling delivery for hedgehog probes that failed under the old
  suppression behavior. Those are gone; the hedgehog re-probes on the
  next tick if it still cares.

## Suggested commit boundaries

1. **`CloudTaskClient.injectPrompt` + unit tests** — pure
   addition, no behavior change yet.
2. **`FeedbackRoutingService.routeHedgehogPrompt` rewire** — switches
   the hedgehog path to direct injection with terminal-run fallback.
3. **Router simplification** — `promptRouting.ts` shrinks and
   `useHedgemonyPromptRouter` loses the suppress branch.
4. **System-prompt cleanup** — remove the "task tab not open"
   Operational Posture clause.

Each independently revertable.

## Migration risk

Low. The new path is additive (the `CloudTaskClient.injectPrompt`
method); the rewire switches `routeHedgehogPrompt` from event-emit
to direct call, but the renderer-fallback path is preserved for
genuinely terminated runs. Worst case if cloud-side has a hiccup:
hedgehog probes fail with `routedOutcome: "failed"` until cloud is
back, identical to today's failure mode for unrelated reasons.
