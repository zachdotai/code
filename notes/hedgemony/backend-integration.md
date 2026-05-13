# Hedgemony — Backend Integration

How Hedgemony plugs into existing posthog-code internals. Companion doc: [backend-frontend.md](./backend-frontend.md). Product spec: [spec.md](./spec.md).

---

## Modularity principles

Hedgemony is a self-contained feature. Reuse posthog-code primitives, but design the boundary so we can feature-flag it off, swap implementations, or extract it later if needed.

- **Namespaced storage.** All Hedgemony tables prefixed `hedgemony_`. No new columns added to existing tables (`tasks`, `workspaces`, etc.).
- **Service isolation.** Hedgemony services live under `apps/code/src/main/services/hedgemony/`. They depend on existing services through interfaces, not the other way around.
- **Feature flag.** Whole feature gated. Disabled → no tables created, no services registered, no UI route.
- **No upstream coupling.** Existing posthog-code code doesn't import from `services/hedgemony/`. The integration points are: Hedgemony reads `SignalReport`s, creates `Task`s, watches PRs, calls `sendPromptToAgent`. All of those already exist.

---

## Hibernacula — data model

New sqlite tables in posthog-code's existing `better-sqlite3` db. All schemas use UUID primary keys, `created_at` / `updated_at` timestamps, and `deleted_at` soft-delete columns so the future migration to PostHog-cloud-backed storage is mechanical.

| Table | Purpose |
|---|---|
| `hedgemony_nest` | Goal record. Fields: `id`, `name`, `goal_prompt` (freeform), `map_x` / `map_y` (placement), `status` (active/dormant/archived), optional `target_metric_id`, `loadout_json` (skills/MCPs/docs/etc). **No `repo` field** — repo membership is derived from a nest's hoglets. |
| `hedgemony_hoglet` | Sidecar row tying a posthog-code `Task` into the nest world. Fields: `id`, `task_id` (FK to `tasks`), `nest_id` (nullable — null = wild hoglet), `signal_report_id` (nullable — null = ad-hoc), `created_at`. Tasks without a row here are invisible to Hedgemony. |
| `hedgemony_pr_dependency` | Edges in the per-nest PR graph. Fields: `id`, `nest_id`, `parent_task_id`, `child_task_id`, `state` (pending/satisfied/broken). |
| `hedgemony_feedback_event` | Audit log of routed feedback. Fields: `id`, `nest_id`, `hoglet_task_id`, `source` (pr_review/ci/issue), `payload_json`, `injected_at`. Lets the hedgehog avoid double-routing and gives the UI an activity feed. |
| `hedgemony_hedgehog_state` | Hedgehog's per-nest scratchpad. Fields: `nest_id` (PK), `scratchpad_json` (small JSON: in-flight decisions, current goal-judgment confidence, notes for next tick), `last_tick_at`, `state` (idle/ticking/proposing-completion). The hedgehog is not a `Task` — see [Hedgehog orchestrator](#hedgehog-orchestrator). |

Long-form context (per-nest notes, accumulated reasoning) lives as markdown files in each nest's worktree, not in sqlite.

Migrations follow the existing pattern in `apps/code/src/main/db/`. Repository pattern matches existing repositories (`apps/code/src/main/db/repositories/`).

---

## Hoglet — Task association

A hoglet is a `Task` with a row in `hedgemony_hoglet`. The Task itself is unchanged: same `not_started → in_progress → completed/failed` lifecycle, same workspace/branch/harness/MCP/skills.

- **Spawn flow**: Hedgemony creates a Task via the existing task-creation saga (`apps/code/src/renderer/sagas/task/task-creation.ts`), then inserts a `hedgemony_hoglet` row binding it to a nest (or null = wild) and optionally to a signal report.
- **Read flow**: "Show me a nest's hoglets" = `JOIN hedgemony_hoglet h ON h.nest_id = ? LEFT JOIN tasks t ON h.task_id = t.id`.
- **Wild hoglet**: row exists with `nest_id = null`. Adoption = UPDATE that field.

---

## Signal ingestion — defer to autonomy, adopt after

PostHog's existing **autonomy** system (`products/signals/`) already auto-starts a `Task` from high-priority `SignalReport`s. Hedgemony does **not** duplicate that ingestion path — it would race with autonomy and create twin tasks for the same report. Instead, Hedgemony watches for autonomy-created tasks and *adopts* them into the nest world:

1. Hedgemony polls (reuses `PosthogAPIClient.getSignalReports()`) for reports whose `implementation_pr_url` or linked `TaskRun` indicates autonomy spawned a Task — i.e. autonomy already did the heavy lifting.
2. Skip reports already adopted (check `hedgemony_hoglet.signal_report_id` uniqueness).
3. For each newly autonomy-started Task tied to a not-yet-adopted report, insert a `hedgemony_hoglet` row with `task_id` (existing Task) + `signal_report_id` set. `nest_id` decided by the [affinity router](#affinity-router--goal-based-not-repo-based).
4. The hoglet's status (idle / running) is whatever autonomy already set on its `TaskRun`. The hedgehog observes and decides whether to raise it (if still idle), hold, or kill (if she thinks it's misdirected).
5. **Adoption race**: `hedgemony_hoglet (signal_report_id)` has a uniqueness constraint with null handling; insert-or-ignore semantics so two adoption attempts can't both succeed.

For reports autonomy *didn't* auto-start (lower priority, or autonomy disabled), Hedgemony can optionally spawn a hoglet directly via the existing task-creation saga — flagged off in v1 to avoid overlap surprises.

---

## Affinity router — goal-based, not repo-based

A nest has no repo field. Routing is semantic match against the nest's `goal_prompt`, computed entirely server-side via existing PostHog primitives — no new SDK dependency.

**v1 implementation:**

PostHog already exposes `embedText('text', model?)` as a HogQL function (`posthog/hogql/functions/embed_text.py` → `posthog.api.embedding_worker.generate_embedding`) and a `DocumentSimilarityQuery` query type (already in `apps/code/src/renderer/api/generated.ts`) for nearest-neighbor search against the `document_embeddings` table where signal reports are already embedded by the signals pipeline.

Routing flow:

1. New `SignalReport` arrives. We have its `id` (= an `EmbeddedDocument` in PostHog's table).
2. For each active nest, issue a HogQL query: `embedText(nest.goal_prompt) <-> SignalReport.embedding` and rank distance.
   - In v1 batch all active nests in one query rather than N round-trips.
3. Highest-scoring nest above threshold wins → that becomes `hedgemony_hoglet.nest_id`.
4. Tiebreak / weighting bumps for: `source_products` overlap with the nest's recent hoglet sources, recent activity in the same area.
5. No match above threshold → `nest_id = null` (wild hoglet, lands in the holding area).

The `goal_prompt` does **not** need to be persisted server-side. `embedText()` embeds on-the-fly per query, so changing a nest's goal just changes future routing — no migration.

**v2:** LLM judge for borderline cases; learned routing from operator adoptions; cache goal-prompt embeddings client-side or in the hibernacula to skip the per-query embed call when goals are stable.

Repo affinity emerges naturally — a nest whose goal is "improve checkout conversion" will accumulate hoglets that touch checkout-related repos, which feeds back into the source_products weighting. Repo is derived, never declared.

---

## Event sources

Hedgemony's autonomy needs three external event types: **PR state changes** (open/merge/close), **new PR review comments**, and **CI status changes**.

**v1: poll everything locally.**

- A main-process `EventSourceService` polls existing posthog-code services on an interval: `git/service.ts: getTaskPrStatus` for PR state, `github-integration/service.ts` for review comments and CI status.
- Polled events feed a local in-process event bus that downstream Hedgemony services (PR graph, feedback routing, hedgehog) subscribe to.
- Hedgehog heartbeat: local timer.

Zero new cloud infra, zero changes to upstream `posthog/products/tasks/`. The whole feature ships from a posthog-code branch.

**What's already in place upstream** (referenced by future v2 work, not consumed in v1):

- `webhooks.py: handle_pull_request_event` — GitHub `pull_request` events already land here and auto-resolve linked signal reports on merge. Future v2 graduation: extend it to fan PR events out to posthog-code via the existing cloud-task SSE channel, eliminating the local poll for merges.
- `TaskAutomation` (`automation_service.py` + `temporal/automation/`) — cron-scheduled `TaskRun`s in background mode. If/when the hedgehog moves cloud-side (v2 persistence rung), this drives her heartbeat.
- `PostHogCodeAgentRelayWorkflow` (`temporal/slack_relay/`) — bidirectional Slack ↔ agent relay. Used in v2 for out-of-band notifications (see [Out-of-band notifications](#out-of-band-notifications-v2)).

**Not covered anywhere yet:** automated `pull_request_review` / `pull_request_review_comment` handling. v1 polls locally; v2 will need a new upstream webhook handler before it can graduate off polling.

See [Considered alternatives](#considered-alternatives) for the other event-source patterns evaluated.

---

## Hedgehog orchestrator

**She is not a Task.** She's a stateless function over persisted state — each tick is an ephemeral LLM call dispatched by `HedgehogTickService`.

### Runtime model

- One row in `hedgemony_hedgehog_state` per active nest. Her scratchpad lives there; nothing else persists across ticks.
- A tick is: load state + relevant joined context (current hoglets, PR graph, recent events) → make one Claude API call with the goal prompt + structured state + an event payload + a tool list → parse `tool_use` responses → dispatch each one to the corresponding Hedgemony service method → write `scratchpad_json` + `last_tick_at` → done.
- No claude-agent-sdk session, no agent harness, no sandbox, no worktree. She doesn't touch files. Tools are service method bindings, not agent SDK tools. Lightweight enough that ticks are bounded in both time and token cost.
- This is exactly the shape `TaskAutomation` schedules on the cloud side (`automation_service.run_task_automation`) — if she ever moves cloud-side, each tick becomes a Temporal-scheduled `run_task_automation` call. Same code, different scheduler.

### Scheduling

- **Event-driven**: subscribes to the in-process event bus from [Event sources](#event-sources). New event for a nest → fire a tick for that nest.
- **Heartbeat**: a local timer (configurable per nest, default ~5 min) for goal-judgment checks even when no events fire.
- **Backpressure**: at most one in-flight tick per nest; concurrent events coalesce into the next tick's input.

### Tools (Claude `tool_use` definitions dispatched to services)

- `spawn_hoglet(prompt, signal_report_id?)` → `NestService.spawnHoglet`. Creates Task + hoglet row.
- `raise_hoglet(hoglet_id)` → starts the Task's `TaskRun`.
- `kill_hoglet(hoglet_id, reason)` → cancels.
- `link_pr_dependency(parent, child)` / `unlink_pr_dependency`.
- `rebase_child(child_task_id)` → triggers a rebase via worktree-manager.
- `route_feedback(hoglet_id, prompt)` → reuses `sendPromptToAgent` (see [Feedback routing](#feedback-routing-pr-review--ci)).
- `propose_completion(summary)` → marks the nest as proposing-completion; operator confirms via the UI.
- `note(text)` → appends to the scratchpad for next tick's context.

### Why not in-memory continuous-conversation context

A persistent in-conversation hedgehog would need a context-compaction loop (truncate old turns / summarize on threshold) to stay sane over a goal that runs for days. The ephemeral model dodges it entirely: every tick assembles fresh structured context, no transcript grows. Token cost per tick is small and predictable; testing is `(state, event) → decisions`; crash recovery is free because state always lives in sqlite. See [Considered alternatives](#considered-alternatives).

---

## PR dependency graph

The hedgehog maintains a DAG per nest in `hedgemony_pr_dependency`. Edges are explicit — she declares "PR B depends on PR A" when she spawns B referencing A's work.

- **Detection**: see [Event sources](#event-sources). v1 polls `getTaskPrStatus` for nest hoglets; v2 piggybacks on the existing upstream `handle_pull_request_event` webhook (which already auto-resolves signal reports on merge). On parent merge → state transitions to `satisfied`, child gets a rebase signal.
- **Execution**: rebases run through the existing worktree-manager (`packages/agent/src/worktree-manager.ts`). No new git plumbing.
- **Conflict handling (v1)**: rebase fails → child hoglet receives a routed prompt ("rebase conflict, resolve and continue"). Real conflict resolution stays with the hoglet, not the hedgehog.

---

## Feedback routing (PR review + CI)

posthog-code already has the entire mechanism, currently driven by user click. Hedgemony automates it.

- **Existing prompt builders** in `apps/code/src/renderer/features/code-review/utils/reviewPrompts.ts`:
  - `buildFixPrCommentPrompt(filePath, line, side, comments)`
  - `buildBatchedInlineCommentsPrompt(drafts)`
  - `buildAskAboutPrCommentPrompt(...)`
  - `buildInlineCommentPrompt(...)`
- **Existing injector**: `sendPromptToAgent(taskId, prompt)` — sends the prompt as a new message into the task's conversation.
- **Existing UI hook**: "Fix with agent" button on `PrCommentThread`, batched-send on `PendingReviewBar`.

**What's genuinely new**: nothing upstream currently handles `pull_request_review` or `pull_request_review_comment` GitHub events. Today's "Fix with agent" flow is purely user-click-driven. The hedgehog automating this is a real new capability, not a re-wiring of something existing.

**Hedgemony wiring**: a `FeedbackRoutingService` (main process, follows the services-over-hooks pattern in CLAUDE.md) consumes events per [Event sources](#event-sources) — v1 polls via the existing github-integration service; v2 can graduate to a new upstream webhook handler + SSE push.

For each new comment or failure, the routing path depends on hoglet state:

- **Hoglet has an active, connected session** (`session.status === "connected"`): build a prompt with the existing builders → call `sendPromptToAgent(task_id, prompt)` → log an entry in `hedgemony_feedback_event`. Same flow today's manual "Fix with agent" button uses.
- **Hoglet's session is closed / disconnected / completed** (PR merged, task ended): cannot inject — `sendPromptToAgent` requires an active session (see `useFixWithAgent`). Instead, **spawn a follow-up hoglet** in the same nest with a prompt like *"review comment on PR X (already merged): [comment]. Open a follow-up PR addressing this."* The follow-up hoglet is linked to the original via `parent_task_id` in `hedgemony_pr_dependency` (state = `pending`) so the hedgehog tracks them together.

The hedgehog has visibility into `hedgemony_feedback_event` so she can decide whether to also intervene (e.g. spawn a sibling hoglet for context, mark a hoglet stuck and reassign).

---

## Goal judgment

Hedgehog reads `goal_prompt` plus accumulated work (merged PRs in `hedgemony_pr_dependency`, resolved signal reports linked via hoglets) and decides. Implementation: an LLM judge call with the goal + a structured summary of completed work + open hoglets. Returns one of: `not_satisfied`, `likely_satisfied`, `definitely_satisfied`. Always requires operator confirmation in v1 — auto-close is v2.

Optional `target_metric_id` on the nest: hedgehog watches it via PostHog MCP and includes the trend in her judgment.

---

## Main-process services + DI

All Hedgemony services live under `apps/code/src/main/services/hedgemony/`:

- `nest-service.ts`
- `hedgehog-service.ts`
- `affinity-router.ts`
- `event-source-service.ts`
- `pr-graph-service.ts`
- `feedback-routing-service.ts`

Registered in the existing `apps/code/src/main/di/container.ts` behind a `hedgemonyEnabled` check, so all services share the main container's bindings (logger, db, MCP, `PosthogAPIClient`). This matches every other feature in the repo and is the lowest-friction wiring.

**Boundary discipline (mandatory).** Nothing outside `services/hedgemony/` may import from inside it. Hedgemony depends on existing posthog-code services through their public interfaces only. If we ever need to extract this feature into its own package or repo, the move is `mv services/hedgemony/ → packages/hedgemony/` plus import-path updates — the internal shape doesn't change. See [Considered alternatives](#considered-alternatives) for the sub-container and workspace-package options that were evaluated and deferred.

---

## v1 safety caps

Hedgemony autonomy needs guardrails before shipping. A misbehaving hedgehog could spawn hundreds of hoglets in a tick or burn through tokens. v1 ships with conservative caps; tune up later with data.

| Cap | v1 default | Where enforced |
|---|---|---|
| Max active hoglets per nest | 10 | `NestService.spawnHoglet` checks before insert; returns `error: nest_capacity` to the hedgehog |
| Max hoglet spawns per tick | 3 | `HedgehogTickService` post-processes tool calls; trims and logs `spawns_capped` |
| Min seconds between ticks per nest | 30s | `HedgehogTickService` debounces event-driven ticks |
| Max ticks per nest per hour | 60 | Rolling counter on `hedgemony_hedgehog_state`; over-cap ticks no-op with a log entry |
| Max LLM tokens per tick | 8k input + 2k output | Prompt assembly trims oldest scratchpad entries; output cap via Claude API param |
| Max wild hoglets in holding area | 25 | Oldest evicted (with audit row) when exceeded — forces operator to triage |

All caps surfaced in `settingsStore` so power users can raise them per-machine; cloud-side overrides come in v2. When a cap fires, log to telemetry under `hedgemony.cap_*` so we can tell whether defaults are too tight in practice.

---

## Feature flag

Two layers:

1. **Cloud flag** — PostHog feature flag (`hedgemony_enabled`), checked at app startup, gates registration of services + UI route.
2. **Local override** — user setting in `settingsStore` so power users can opt in before the cloud rollout.

When disabled: services not constructed, tables not created (or empty), renderer route returns null. No new code runs in the hot path.

---

## Migrations

Standard posthog-code sqlite migration in `apps/code/src/main/db/`. One migration file creates all five Hedgemony tables; future migrations add columns as needed. Migrations always run (they're idempotent) even when the feature flag is off — keeps schema state consistent and avoids "first-toggle creates tables on hot path" pitfalls. Empty tables cost nothing.

---

## Out-of-band notifications (v2)

posthog cloud already has `PostHogCodeAgentRelayWorkflow` (`products/tasks/backend/temporal/slack_relay/`) for bidirectional Slack ↔ Code agent messaging, including markdown ↔ Slack mrkdwn conversion.

v2 wiring for Hedgemony:

- **Hedgehog → operator notifications**: nest hits goal, nest stuck, hoglet blocked too long, rebase conflict persists. Relay through `PostHogCodeAgentRelayWorkflow` to the operator's Slack DM or a configured channel.
- **Operator → hedgehog commands** (out of band): "pause nest X", "ship all merged PRs from nest X", "spawn ad-hoc hoglet for $thing". Same channel, reverse direction.

Out of v1 scope. The relay primitive is in place so this is purely product/UX work when it's time.

---

## Considered alternatives

Choices we evaluated and didn't ship in v1. Documenting so we don't relitigate them and so we have a reference if v1 assumptions break.

### Event-source patterns

In addition to **local polling** (v1), two cloud-side patterns were considered:

- **Cloud-piggyback poll** — extend the upstream `webhooks.py` handler to write events to a new "events" table; posthog-code polls a new PostHog API endpoint for unconsumed events. Medium latency. Cost: new table + endpoint upstream, new poll in posthog-code. Rejected for v1 because it requires upstream changes and we want a posthog-code-only shipping unit.
- **Cloud push (SSE)** — extend the existing cloud-task SSE channel (`apps/code/src/main/services/cloud-task/sse-parser.ts`) to relay Hedgemony events from `webhooks.py` straight to the local instance. Low latency. Cost: new event types on the SSE channel + new server-side fanout. The v2 graduation target.

### DI / service isolation

Two stricter modularity options were considered above the chosen "feature folder, shared container":

- **Feature folder, own DI sub-container** — Hedgemony has its own InversifyJS container that gets the main container as a parent. Cleaner boundary, easier to swap implementations. Rejected as ceremony with no v1 payoff. Boundary discipline (mandatory import rule) gives us the same property without the wiring.
- **Workspace package (`packages/hedgemony/`)** — Hedgemony lives as a sibling to `packages/agent`, `packages/git`. Fully extractable. Rejected for v1 — significant up-front cost (workspace setup, build config, dep policing) for a feature still finding its shape. If extraction becomes a hard requirement later, the migration is mechanical given the boundary discipline.

### Signal ingestion path

We considered extending Inbox's existing autonomy flow (which already auto-starts Tasks from high-priority `SignalReport`s) instead of registering a separate Hedgemony poll. Rejected — keeping the ingestion paths separate makes Hedgemony cleanly disable-able by the feature flag, and avoids surprising Inbox-only users with side effects from Hedgemony's affinity router.

### Hedgehog runtime model

Three shapes were considered; v1 ships the third.

- **Long-running `Task`.** The hedgehog as a single Task whose `TaskRun` never completes; new prompts injected via `sendPromptToAgent` on every event. Rejected — posthog-code's Task lifecycle assumes a definite end (PR ships or fails). An infinite-lived Task pollutes the task list, breaks "completed/failed" semantics, and forces us to design a context-compaction loop on top.
- **Separate long-running daemon.** A persistent in-process service holding the hedgehog's LLM conversation in memory, with periodic state snapshots to sqlite. Rejected on the same compaction concern — a goal that runs for days produces a growing transcript that needs truncation / summarization, and stateful in-memory orchestrators introduce "is she alive?" failure modes.
- **Ephemeral per-tick (chosen, v1).** No Task, no persistent process. Each tick is a stateless function over `(scratchpad, joined context, event)`. State always on disk, token cost bounded, testing trivial, cloud-side migration mechanical via `TaskAutomation`.

### Orchestration harness

Two harness-shaped options were considered alongside the chosen "no harness, raw Claude API calls from the service."

- **New `orchestrator` harness** in `packages/agent` wrapping the Claude Agent SDK with a constrained tool list. Rejected — agent SDK overhead (session lifecycle, sandboxing) buys nothing when the hedgehog doesn't touch files. Each tick is a single LLM call with `tool_use`, then service dispatch.
- **Constrained existing harness** (claude/codex with a tool allowlist passed through). Rejected — posthog-code's harness adapters aren't currently parameterized this way, and even if they were, the per-tick model means we'd be paying session setup cost on every tick.
