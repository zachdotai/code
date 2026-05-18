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
`FeedbackRoutingService.routeHedgehogPrompt` calls a new
`CloudTaskClient.injectPrompt(taskRunId, prompt)` method directly,
which POSTs the prompt to whatever cloud-task endpoint the renderer's
`sendPromptToAgent` ultimately resolves to. The renderer is removed
from the loop for hedgehog-source events entirely.

For non-hedgehog sources (`pr_review`, `ci`, `issue`), the existing
renderer-mediated routing stays in place — those routes deliberately
fall back to `spawnFollowUpHoglet` when the original run has ended,
which is correct behavior for feedback on closed hoglets.

The `useHedgemonyPromptRouter` hook collapses to a much smaller
surface: it only handles the non-hedgehog feedback paths, since
hedgehog events no longer flow through the renderer.

## Open questions (resolve before implementation)

1. **Does the cloud-task API expose a main-callable
   message-injection endpoint?** The renderer's `sendPromptToAgent`
   ultimately routes through some path that reaches the cloud agent's
   conversation. We need to confirm:
   - That path goes through an HTTP endpoint (not just an in-process
     ACP socket).
   - Authentication for that endpoint accepts the same credentials
     the renderer uses, callable from main without an existing
     socket.
   - Idempotency: if main sends a duplicate (e.g., on retry), the
     cloud handles it cleanly.

   If the answer is "the only path is the ACP socket the renderer
   holds," then the design changes — main would need to hold its own
   persistent ACP socket per active hoglet, or the cloud-side would
   need a new HTTP endpoint.

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
  taskRunId: string;
  prompt: string;
  /** Source identifier — hedgemony surfaces this so the cloud-side
   *  can label/style the message as hedgehog-authored rather than
   *  operator-authored. */
  authoredBy: "hedgehog";
}): Promise<{ accepted: true } | { accepted: false; reason: string }>;
```

Implementation depends on the answer to open question 1. Likely a
POST to a cloud endpoint like
`/api/projects/{project}/tasks/{task}/runs/{run}/inject/` with body
`{ prompt, authored_by: "hedgehog" }`. The fetch is
authenticated via the existing `auth.authenticatedFetch` plumbing
already used by `createTaskRun` and `getTaskWithLatestRun`.

Error handling:
- 404 → run terminated → return `{ accepted: false, reason:
  "run_terminated" }`.
- 5xx → throw → caller decides whether to retry on next tick.

### 2. `FeedbackRoutingService.routeHedgehogPrompt` rewires

**File:** `apps/code/src/main/services/hedgemony/feedback-routing-service.ts`

`routeHedgehogPrompt` currently emits an `InjectPrompt` event for the
renderer router to handle. Change it to:

```ts
async routeHedgehogPrompt(input: RouteHedgehogPromptInput): Promise<void> {
  // 1) Resolve the active taskRunId for this hoglet via cloudTasks.
  const { latestRun } = await this.cloudTasks.getTaskWithLatestRun(input.taskId);
  if (!latestRun) {
    // No active run. Fall back to the existing spawn-follow-up path.
    return this.emitInjectPromptForRendererFallback(input);
  }

  // 2) Try direct injection.
  const result = await this.cloudTasks.injectPrompt({
    taskRunId: latestRun.id,
    prompt: input.prompt,
    authoredBy: "hedgehog",
  });

  if (result.accepted) {
    this.recordRoutedOutcome({
      nestId: input.nestId,
      hogletTaskId: input.taskId,
      source: "hedgehog",
      payloadHash: input.payloadHash,
      payloadRef: input.payloadRef,
      routedOutcome: "injected",
      trustTier: "internal",
    });
    return;
  }

  // 3) Cloud-side rejected (e.g., run terminated mid-flight). Fall
  //    back to spawn-follow-up via the renderer-mediated path.
  if (result.reason === "run_terminated") {
    return this.emitInjectPromptForRendererFallback(input);
  }

  // 4) Other rejection (auth, validation, etc.). Surface as failed.
  this.recordRoutedOutcome({ ..., routedOutcome: "failed" });
}

private emitInjectPromptForRendererFallback(input: RouteHedgehogPromptInput): void {
  this.emit(FeedbackRoutingEvent.InjectPrompt, {
    taskId: input.taskId,
    hogletId: input.hogletId,
    nestId: input.nestId,
    source: "hedgehog",
    targetRunStatus: input.targetRunStatus,
    payloadRef: input.payloadRef,
    payloadHash: input.payloadHash,
    prompt: input.prompt,
    prUrl: "",
    fallbackPrompt: input.prompt,
  });
}
```

The renderer-fallback path is intentionally narrow: it fires only
when the cloud-side told us the run is terminated and a follow-up
spawn is the right answer. The renderer router's existing logic for
that case (`spawn_follow_up`) handles it.

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

Cleaner: the second option. The router decision in `promptRouting.ts`
shrinks to:

```ts
export function resolveHedgemonyPromptRoute(input: {
  payload: InjectPromptEventPayload;
  sessionStatus: string | null | undefined;
}): PromptRoute {
  if (input.sessionStatus === "connected") return "inject";
  return input.payload.nestId ? "spawn_follow_up" : "failed";
}
```

No more `targetRunStatus`, no more `suppress_hedgehog_follow_up`.
The `targetRunStatus` field on `InjectPromptEventPayload` can be
removed (or marked deprecated).

### 4. System-prompt cleanup

**File:** `apps/code/src/main/services/hedgemony/hedgehog-prompts.ts`

Remove the short-term "task tab not open" Operational Posture clause
once direct injection is in place. The hedgehog should never see
that audit in normal operation; if it ever appears (run terminated,
cloud rejected), the existing fallback path handles it identically
to a terminated-run probe.

### 5. Tests

- `cloud-task-client.test.ts`: cover `injectPrompt` happy path,
  404 → `{ accepted: false, reason: "run_terminated" }`, 5xx
  throws.
- `feedback-routing-service.test.ts`: cover three branches of
  `routeHedgehogPrompt` — direct-inject success, run-terminated
  fallback to emit, other-rejection failed outcome.
- `promptRouting.test.ts`: simplify since `suppress_hedgehog_follow_up`
  is gone.
- `useHedgemonyPromptRouter.test.ts`: remove the
  suppress-branch tests; verify pr_review / ci paths unchanged.
- Manual / e2e: spawn a nest with a hoglet, do NOT attach its tab,
  have the hedgehog message it via operator chat ("ask hoglet X what
  it's working on"). Verify the message lands in the hoglet's
  conversation (visible when you later attach the tab) without
  attachment being a precondition.

## Cloud-side prerequisites (if open question 1 requires it)

If the cloud-task API doesn't currently expose a main-callable
inject endpoint, we'll need to coordinate with the posthog-cloud
team to add one. Specification:

- **Endpoint:** `POST /api/projects/{project_id}/cloud_tasks/{task_id}/runs/{run_id}/inject/`
- **Auth:** same Bearer token the renderer uses; main authenticates
  with the operator's credentials (no separate service account).
- **Request:** `{ prompt: string, authored_by: "hedgehog" | "operator" }`.
- **Response:** `202 Accepted` with the queued message identifier,
  or `404` if the run has terminated, or `409` if the agent isn't
  in a state that accepts new prompts (e.g., a previous prompt is
  still being processed and serialization is required).
- **Conversation surfacing:** when an `authored_by: "hedgehog"`
  prompt is injected, the agent's session log should record it as
  distinct from operator-authored prompts, so renderer-side rendering
  can style hedgehog messages (e.g., with a small "from hedgehog"
  badge instead of the operator avatar).

If coordination is heavy, fall back to a transitional approach:
main holds its own lightweight ACP socket per active hoglet (used
purely for injection, not observation) and routes hedgehog messages
through it. More code in main, no cloud-side change required, but
duplicates connection state.

## Out of scope

- Persistent durable queue for cases where the cloud-side is briefly
  unavailable (5xx, network blip). In-tick retry handled by the
  hedgehog's own tool-error recovery; multi-tick durability is a
  follow-up if observed reliability is a problem.
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
   the hedgehog path to direct injection with run-terminated
   fallback.
3. **Router simplification** — `promptRouting.ts` shrinks,
   `useHedgemonyPromptRouter` loses the suppress branch and the
   targetRunStatus plumbing.
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
