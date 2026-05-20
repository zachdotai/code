# Hedgemony — Code Review Fixes

P0/P1 issues from branch review (2026-05-14). Organized by fix priority.
Reference: [spec.md](./spec.md), [backend-integration.md](./backend-integration.md).

---

## Fix first (safety / correctness)

### 1. PR comment body injected without `<untrusted_signal>` wrapping — DONE

**File:** `feedback-routing-service.ts` — `buildPrCommentPrompt()`, `buildFollowUpPrompt()`, `buildCiFailurePrompt()`

`buildPrCommentPrompt()` passes raw `comment.body` and `login` into the agent
prompt without the `<untrusted_signal>` delimiters the spec requires for external
content. Same issue in `buildFollowUpPrompt()` and `buildCiFailurePrompt()`. Any
GitHub user with PR comment access could inject instructions the agent would
follow. The hedgehog's own system prompt explicitly says untrusted content is
wrapped — but it isn't here.

**Fix:** Wrap all external fields (`body`, `login`, check names, CI URLs) in
`<untrusted_signal>...</untrusted_signal>` blocks before interpolating into the
prompt string. Match the pattern used in `hedgehog-prompts.ts` for signal report
content.

### 2. `hedgemony_operator_decision` entirely missing — DONE

**Files:** All service files, `schema.ts`

The spec's "operator override memory" table, repository, and pre-dispatch
consultation are not implemented. Without it, a killed hoglet can be respawned
next tick, creating the "whack-a-mole" loop the spec explicitly warns about.

**Fix:** Implement the full path:
- Add `hedgemony_operator_decision` table to schema + migration
- Add repository with CRUD
- Load relevant rows before each tick in `HedgehogTickService`
- Render them in the prompt's "do-not-redo" section
- Add service-level enforcement: `spawn_hoglet` cross-checks `signal_report_id`
  against suppress decisions; `kill_hoglet` is a no-op if operator already revived

### 3. `feedbackRepo.insertIgnoreOnDuplicate` is not truly atomic — DONE

**File:** `feedback-event-repository.ts` (~line 58-93)

Does a read-then-insert instead of `INSERT ... ON CONFLICT IGNORE`. If a race
slips through the app-level check, the sqlite UNIQUE constraint throws an
uncaught error instead of silently ignoring the duplicate.

**Fix:** Replace the select-then-insert with drizzle's `onConflictDoNothing()`
on the insert statement, or catch the sqlite constraint violation error and
treat it as a successful no-op.

### 4. `raise-hoglet-handler` lacks rollback on partial failure — DONE

**File:** `raise-hoglet-handler.ts` (~line 63-78)

Calls `createTaskRun` -> `ensureCloudWorkspace` -> `startTaskRun` sequentially
without the Saga pattern used by spawn flows. If a middle step fails, the
already-created cloud task run is never cancelled. Orphaned cloud resources.

**Fix:** Either wrap in a `HogletRaiseSaga` (matching the spawn pattern) with
rollback steps for each cloud operation, or add explicit try/catch cleanup that
cancels the task run if a subsequent step fails.

---

## Fix next (spec compliance)

### 5. Missing hourly tick cap — DONE

**File:** `hedgehog-tick-service.ts`

The spec requires max 60 ticks/nest/hour via a sliding-window counter over
`hedgemony_tick_log`. Only the 30s debounce (`MIN_TICK_INTERVAL_MS`) is enforced,
which theoretically allows ~120 ticks/hour. The `hedgemony_tick_log` table exists
but no hourly count check gates tick execution.

**Fix:** Before executing a tick, query
`COUNT(*) FROM hedgemony_tick_log WHERE nest_id = ? AND ticked_at > now() - 1h`.
If >= 60, no-op and write a row with `outcome = capped`. Expose the cap value
via `settingsStore` per the spec.

### 6. Feedback routing dedup has a check-then-emit race — DONE

**File:** `feedback-routing-service.ts` (~line 282-316)

Dedup checks `feedbackRepo.findByDedupeKey()`, then emits `InjectPrompt`, but
the dedupe row is only written when the renderer calls `recordRoutedOutcome`
later. A second poll cycle can emit a duplicate before the row lands.

**Fix:** Write a "pending" dedupe row to sqlite _before_ emitting the event.
The renderer's `recordRoutedOutcome` then updates the row's status to
"delivered". This makes the dedup check atomic with the intent to route.

### 7. PR dependency table missing UNIQUE constraint — DONE

**File:** `schema.ts` (~line 217-236)

No UNIQUE on `(nestId, parentTaskId, childTaskId)`. App-level dedup via
read-then-insert in `pr-dependency-repository.ts` is TOCTOU-vulnerable.

**Fix:** Add a migration with
`CREATE UNIQUE INDEX ... ON hedgemony_pr_dependency(nest_id, parent_task_id, child_task_id)`.
Update the repository's insert to use `onConflictDoNothing()`.

### 8. Unbounded `pending` queues in FeedbackRoutingService and PrGraphService — DONE

**Files:** `feedback-routing-service.ts` (~line 60), `pr-graph-service.ts` (~line 62)

Both push to `this.pending` when no renderer listener is attached. No cap on
array size. If the hedgemony UI is never opened, these grow unbounded.

**Fix:** Cap the `pending` array (e.g., 100 items). When full, drop the oldest
entry and log a warning. Alternatively, write pending events to sqlite instead
of holding them in memory.

---

## Fix before dogfood (performance / architecture)

### 9. `selectNests` selector causes cascade re-renders — DONE

**File:** `nestStore.ts` (~line 58-59)

Returns `Object.values(state.nests).filter(...)` which creates a new array on
every store update (including `setHedgehogState` every 30s per nest). Every
consumer of `selectNests` re-renders on every tick, even when the nest list
hasn't changed.

**Fix:** Use a memoized selector that returns the same reference when the
underlying `nests` record hasn't changed. Options:
- Cache the result and compare `state.nests` by reference
- Use Zustand's `useShallow` or a custom equality function
- Use `createSelector` from reselect

### 10. PR-graph subscription thrashing — DONE

**File:** `HedgemonyMapView.tsx` (~line 137-142)

`useEffect` depends on `nests` from `selectNests`. Because of issue #9, every
hedgehog tick tears down and recreates all PR-graph watch subscriptions. With N
nests, each tick causes N unsubscribe + N subscribe + N fetch operations, with
brief windows where events are missed.

**Fix:** Depends on fixing #9. Additionally, switch to an incremental diff
approach: track nest IDs and only subscribe/unsubscribe when nests are
added/removed, not on every selector re-evaluation.

### 11. Unbounded re-rendering on hoglet position changes — DONE

**Files:** `WildHogletFlock.tsx` (~line 27), `NestBroodCluster.tsx` (~line 21)

Both subscribe to the entire `positions` object. Moving any hoglet re-renders
every hoglet in every flock/cluster.

**Fix:** Move the position lookup into each child component. Each `WildHoglet`
/ `BroodHoglet` selects only its own position via
`useHogletPositionStore(s => s.positions[hogletId])`. Parent components should
not subscribe to the full positions map.

### 12. `useSignalIngestion` violates store/service boundary — DONE

**File:** `hooks/useSignalIngestion.ts` (~line 100-155)

Multi-step orchestration (fetch artefacts -> build prompt -> create task ->
record sidecar) in a renderer hook. Per CLAUDE.md architecture, this belongs in
a main-process service. If component unmounts mid-ingestion, in-flight work is
lost without cleanup.

**Fix:** Move the ingestion logic to a main-process `SignalIngestionService`.
The renderer hook becomes a thin start/stop toggle that activates/deactivates
the service via tRPC.

### 13. Watch-before-load race in hogletSubscriptionService — DONE

**File:** `hogletSubscriptionService.ts` (~line 88-104)

Watch subscription starts delivering events before the initial `list` query
resolves. When `setBucket` fires, it replaces the bucket wholesale, potentially
discarding upserts from watch events that arrived during the race window. Same
pattern in all subscription initializers.

**Fix:** Either:
- Buffer watch events until the initial load completes, then replay them
- Merge the initial load with accumulated watch events instead of overwriting
- Start the watch subscription only after the initial load resolves

### 14. Camera animation timeouts not cleaned up — DONE

**File:** `HedgemonyMapSurface.tsx` (~line 265-268)

`setTimeout` for camera animations is never cancelled on unmount or when a new
animation starts. Rapid bookmark clicks stack multiple competing timeouts.

**Fix:** Store the timeout handle in a ref. Clear it at the start of each new
`animateToView` call and in the component's cleanup function.

### 15. `usePanCamera` runs continuous RAF with DOM queries — DONE

**File:** `usePanCamera.ts` (~line 158)

Permanent 60fps `requestAnimationFrame` loop runs for the entire map lifetime,
even when idle. Each frame calls `el.querySelectorAll("[data-no-edge-pan]")`
which is expensive.

**Fix:** Cache the `querySelectorAll` result (invalidate on DOM mutation via
`MutationObserver` or on a slower interval). Optionally, only run the RAF loop
when keys are pressed or the cursor is in an edge zone — start on
keydown/mousemove-near-edge, stop after a debounced idle period.

---

## Verified OK (no action needed)

- Per-tick spawn/raise caps (`MAX_SPAWN_CALLS_PER_TICK=3`, `MAX_RAISE_CALLS_PER_TICK=3`) enforced
- `MAX_NEST_HOGLETS=10` checked before spawn
- `MIN_TICK_INTERVAL_MS=30s` debounce works correctly
- Tick service is genuinely stateless per-tick; scratchpad persisted to DB
- DI registrations match token declarations
- Zod schemas align with sqlite tables
- Cloud task client uses `authenticatedFetch` throughout
- Hoglet soft-delete properly filtered in all queries
- Path alias compliance correct across renderer imports
- Abort signal threading in tick service properly handled
- Dying hoglet Map->Record refactor (fixes Zustand serialization) is clean
- All test files match their source changes
