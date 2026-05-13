# Hedgemony — User Stories (Vertical Slices)

How we ship Hedgemony in vertical, demoable slices. Each slice cuts top-to-bottom (migration → main service → tRPC → store → map UI) and ends in an operator-facing moment you can show off. Companion docs: [spec.md](./spec.md), [backend-integration.md](./backend-integration.md), [backend-frontend.md](./backend-frontend.md).

---

## Slicing principles

- **Every slice ships a demoable operator action.** "Operator does X, sees Y." No infra-only slices.
- **Each slice exercises one new schema/capability path** plus the matching service / router / store / UI.
- **Risk-buying slices come after their cheaper neighbors.** Embeddings, the agent harness, and the PR DAG wait until plain CRUD has shaken out the boundary.
- **The hedgehog is decomposed, not one slice.** Brood mgmt → feedback routing → PR graph → goal judgment ship separately so autonomy can be flag-gated progressively.
- **Hedgemony is a Command Center view mode**, not a sidebar entry. Every slice's UI lands inside Command Center's view switcher.

---

## Slice 0 — Empty stadium

**As an operator,** I want to flip on Hedgemony in Command Center and see an empty map view, so I know the feature exists and the chassis works end to end.

**In scope**
- Migration creates the `hedgemony_*` schema (idempotent, runs even when flag off).
- `HEDGEMONY_FLAG = "hedgemony-enabled"` exported from `@shared/constants`.
- Command Center checks `useFeatureFlag(HEDGEMONY_FLAG, import.meta.env.DEV)` before rendering the map toggle.
- Empty `hedgemony` tRPC router/services can be registered normally, but stay side-effect-free when the flag is off.
- New `features/hedgemony/` folder + Command Center view-mode option.
- Pan/zoom map surface with an empty-state.

**Out of scope**
- Any nest, hoglet, or signal logic.

**Acceptance criteria**
- Toggling `hedgemony-enabled` shows/hides the Command Center view-mode option.
- Tables exist in sqlite whether or not the flag is on.
- No Hedgemony pollers, timers, recovery sweeps, or subscriptions run when the flag is off.

**Demo moment**
- Flip the flag → switch Command Center to Hedgemony view → see empty map.

**Why first** — locks in boundary discipline (the mandatory import rule from backend-integration.md) before any feature pressure arrives.

---

## Slice 1 — Create a nest through goal writing (CRUD only, no hedgehog)

**As an operator,** I want to create a nest through a lightweight spec-writing conversation, so the goal has enough definition of done for a hedgehog to manage later.

**In scope**
- `hedgemony_nest` CRUD for `name`, `goal_prompt`, nullable `definition_of_done`, `map_x` / `map_y`, `status`, and empty/default `loadout_json`.
- `hedgemony_nest_message` writes the goal-writing transcript plus the initial "nest created" audit entry as durable creation context.
- `NestService.create / get / list / update / archive` plus the matching sqlite repository. Archive is a soft status change; no row deletion.
- `NestChatService.list` can read creation transcript/audit rows for a nest, but does not yet accept live operator commands.
- tRPC: `nests.create`, `nests.get`, `nests.list`, `nests.update`, `nests.archive`, optional lightweight `nests.watch` for CRUD refreshes, and `nestChat.list`.
- `nestStore` driven by `nests.list` plus `nests.watch` if present; `nestChatStore` is read-only and only shows creation-time transcript/audit context.
- Nest sprite component, nest detail panel, and "create nest" flow capturing name, goal prompt/spec, definition of done, and click/manual map coords.
- "Eject to simple form" path for operators who want name + rough goal without the full goal-writing conversation. The simple form still creates a valid nest with a saved goal prompt and nullable definition of done.

**Out of scope**
- No hedgehog orchestrator spawn (deferred to Slice 6).
- No live nest chat commands, hedgehog replies, or `nestChat.send` behavior (deferred to Slice 6).
- No hoglet roster, adoption, signal staging, affinity routing, or Task state joins.
- No loadout editor beyond saving an empty/default `loadout_json` placeholder (deferred to Slice 10).

**Acceptance criteria**
- Place 3 nests at distinct coords → all persist across app restart.
- Opening a nest detail panel shows the saved goal prompt/spec, definition of done when present, and the creation transcript/audit context.
- `nests.update` can move/rename/edit an active nest without recreating it.
- Archive flips status without dropping the row; archived nests disappear from the default active map list but remain queryable for history/debugging.
- Goal-writing flow produces a saved definition of done, while simple-form eject still creates a valid nest with nullable definition of done.

**Demo moment**
- Create a nest through the goal-writing flow, restart app, confirm it reappears with its saved goal spec and initial chat/audit context.

---

## Slice 2 — Spawn an ad-hoc wild hoglet

**As an operator,** I want to spawn a one-off agent without picking a nest, so I can dispatch unstructured work and still see it in Hedgemony.

**In scope**
- `hedgemony_hoglet` writes with `nest_id = null`, `signal_report_id = null`.
- `HogletService.spawnAdhoc` reuses the existing `task-creation.ts` saga, then inserts the sidecar row.
- tRPC: `hoglets.spawnAdhoc`, `hoglets.list({ wildOnly: true })`, `hoglets.watch`.
- `hogletStore` with a special `wild` key.
- Holding-area drawer + wild hoglet card with live Task status.

**Out of scope**
- No adoption into a nest yet.
- No signal-driven spawn yet.

**Acceptance criteria**
- Spawning produces a Task + a hoglet sidecar row in one transaction.
- Wild card reflects underlying Task state via existing primitives (`not_started → in_progress → completed/failed`) and PR badge from `getTaskPrStatus`.

**Demo moment**
- Spawn ad-hoc → wild card appears → status updates as the Task runs → PR opens → card shows "open PR" badge.

**Why now** — proves the Task ↔ hoglet sidecar pattern with zero hedgehog complexity.

---

## Slice 3 — Adopt an un-nested hoglet into a nest

**As an operator,** I want to drag an un-nested hoglet onto a nest, so I can manually organize one-offs and signal-backed work around an objective.

**In scope**
- `UPDATE hedgemony_hoglet SET nest_id = ?`.
- tRPC: `hoglets.adopt`, `hoglets.release`, `hoglets.list({ nestId })`.
- Drag-drop from drawer onto nest sprite.
- Nest renders its brood positioned around it.

**Out of scope**
- Hedgehog autonomy still doesn't exist — operator drives all routing.

**Acceptance criteria**
- Adopting moves the hoglet's sprite from the drawer/staging area to the target nest.
- Release moves it back to the right place: wild area for ad-hoc hoglets, signal staging for signal-backed hoglets.
- Persists across restart.

**Demo moment**
- Spawn 3 wild hoglets → adopt 2 into nest A, 1 into nest B → see clustering. Restart → state preserved.

---

## Slice 4 — Signals become unnested signal hoglets

**As an operator,** I want net-new PostHog signal reports from the Signals Inbox to appear in Hedgemony as signal-backed hoglets, so I can group related Inbox work into nests.

**In scope**
- `EventSourceService` poll tick: `PosthogAPIClient.getSignalReports`, dedupe via `hedgemony_hoglet.signal_report_id` index.
- Initial prompt built from `title + summary + findings + suggested_reviewers`.
- Unnested signal staging section shows signal-report origin (link + summary line).

**Out of scope**
- No auto-routing — every signal-backed hoglet lands in unnested signal staging for now.
- No hedgehog handling — manual adoption still required.

**Acceptance criteria**
- Same `signal_report_id` never spawns two hoglets.
- Signals remain Inbox-backed; suppress/dismiss actions write through the existing Inbox lifecycle instead of inventing a second state machine.

**Demo moment**
- Trigger a signal in PostHog → unnested signal hoglet appears within the poll interval → adopt into the appropriate nest.

**Risk bought** — ingestion path, dedupe, initial-prompt shape.

---

## Slice 5 — Affinity router

**As an operator,** I want incoming signals to auto-route to the most relevant nest, so I stop hand-sorting things that obviously belong together.

**In scope**
- On-the-fly `embedText`/similarity query over each active nest's goal spec, definition of done, and grouped-signal summaries.
- `AffinityRouter` called from `EventSourceService` before insert.
- Cosine similarity + threshold; sub-threshold falls through to unnested signal staging.
- Tooltip on auto-routed hoglets showing similarity score; drag-reassign still works.

**Out of scope**
- LLM judge for borderline cases (v2).
- Learned routing from operator adoptions (v2).

**Acceptance criteria**
- Threshold is configurable (settings or env, not hard-coded).
- Operator override always wins — a manually adopted hoglet doesn't get re-routed.

**Demo moment**
- Nest "improve checkout conversion" + checkout-related signal → auto-bound. Unrelated signal → unnested signal staging.

**Why here** — manual adoption (Slice 3) needs to work before the router can mis-route silently. Threshold tuning will iterate.

---

## Slice 6 — Hedgehog: brood management only

**As an operator,** I want a hedgehog per nest that autonomously raises and coordinates hoglets, while leaving a clear chat/audit trail of what it did and why.

**In scope**
- `hedgemony_hedgehog_state` rows; no hedgehog Task and no `hedgemony_hoglet.role = 'orchestrator'`.
- `HedgehogTickService`: tick on timer + event-bus + nest chat messages, serialize state at end of each tick, resume from row on app start.
- Constrained tool list: `raise_hoglet`, `kill_hoglet`, `message_hoglet`, `write_audit_entry`.
- Autonomous execution within each hoglet's existing PostHog Code permissions.
- Nest sprite glows when hedgehog is ticking; nest chat shows compact audit entries for spawn/raise/kill/message decisions.

**Out of scope**
- No feedback routing, no PR graph, no goal judgment.

**Acceptance criteria**
- Force-quit app mid-tick → reopen → hedgehog resumes cleanly from `serialized_state_json`.
- Hedgehog has no tools to commit code herself.
- Every high-impact orchestration action produces an operator-visible audit/chat entry.

**Demo moment**
- Nest with 3 idle hoglets → hedgehog raises the right batch → tasks start in parallel → chat/audit explains why.

**Risk bought** — biggest concept in the feature. Keep it minimum-viable; the chat/audit trail is the safety net.

---

## Slice 7 — Feedback routing (PR review + CI)

**As an operator,** I want PR review comments and CI failures to land back on the originating hoglet automatically, so I don't have to click "Fix with agent" myself.

**In scope**
- `hedgemony_feedback_event` writes (dedupes routing).
- `FeedbackRoutingService` polls `github-integration` + `git/service.ts: getTaskPrStatus`.
- Reuses existing `reviewPrompts.ts` builders.
- Calls `sendPromptToAgent` to inject the prompt into the hoglet's conversation.
- `feedback.watch(nestId)` subscription drives an activity feed and writes compact nest chat/audit summaries.

**Out of scope**
- No upstream `pull_request_review` webhook (v2 graduation).
- No Slack relay (v2).

**Acceptance criteria**
- Same comment never routes twice (feedback-event log is the source of truth).
- Failure path: routing failure logs but doesn't crash the hedgehog tick.

**Demo moment**
- Leave a PR review comment → message lands in the hoglet's task automatically → fix commit appears.

**Why now** — highest-leverage autonomy moment. Most of the mechanism exists upstream; this slice is mostly wiring.

---

## Slice 8 — PR dependency graph + auto-rebase

**As an operator,** I want stacked hoglet PRs to rebase automatically when their parent merges, so I'm not manually unblocking a chain every time something lands.

**In scope**
- `hedgemony_pr_dependency` edges with `pending → satisfied → broken` state machine.
- `PrGraphService`; new hedgehog tools `link_pr_dependency`, `unlink_pr_dependency`, `rebase_child`.
- Rebases run through the existing `worktree-manager`.
- Conflict path: failed rebase routes a "resolve and continue" prompt back to the child hoglet.
- Map UI: arrows between hoglet sprites; edge color tracks state.

**Out of scope**
- Hedgehog autonomously resolving conflicts (stays with the hoglet).

**Acceptance criteria**
- Parent merge → child rebases without operator action.
- Conflict → child receives a routed prompt; edge state goes `broken` until resolved.

**Demo moment**
- Nest with PR B depending on PR A → merge A → B auto-rebases on master+A.

---

## Slice 9 — Goal judgment + propose completion

**As an operator,** I want the hedgehog to tell me when she thinks a nest's goal is satisfied, so closing nests doesn't become my job to remember.

**In scope**
- `propose_completion` hedgehog tool.
- LLM judge call over goal spec + definition of done + merged PRs in `hedgemony_pr_dependency` + resolved signal reports.
- Returns `not_satisfied | likely_satisfied | definitely_satisfied`.
- Operator-confirmation modal showing the summary + PR list.
- Confirmed close transitions nest to dormant; hibernacula preserved.

**Out of scope**
- Auto-close above a confidence threshold (v2).
- Live metric watching via PostHog MCP (deferred; optional `target_metric_id` lands in Slice 10).

**Acceptance criteria**
- Operator confirmation is always required.
- Dormant nest's hoglets and PRs remain queryable.

**Demo moment**
- Nest with 3 merged PRs touching checkout → hedgehog proposes close with summary → operator confirms → nest goes dormant.

---

## Slice 10 — Prickle + loadout editor (polish)

**As an operator,** I want to select multiple hoglets at once and edit a nest's loadout, so power-user flows feel like an RTS instead of a form.

**In scope**
- `selectionStore`: drag-select box, ctrl+click toggle, ctrl+1/2/3 group bind + recall.
- Group ops bar: dispatch, adopt, kill, batched custom prompt.
- `loadoutDraftStore`: optimistic edits to skills / MCPs / docs / optional `target_metric_id`.
- `nests.update` accepts full `loadout_json`; subsequent hedgehog spawns pick it up.
- Settings-style panel on each nest.

**Out of scope**
- Per-hoglet loadout customization at spawn time (operator can still send custom prompts via the existing Task UI).

**Acceptance criteria**
- Selection is never persisted (purely client-side).
- Loadout edits apply to the next spawn, not retroactively to running hoglets.

**Demo moment**
- Drag-select 4 hoglets, send a batched prompt; edit nest loadout, watch the next spawn pick it up.

**Why last** — none of the autonomy slices need it. It's the quality-of-life layer that sells once the substrate works.

---

## Checkpoints

- **After Slice 3** — first internal demo. Map "feels alive" with manual ops only. Cheap validation of whether the spatial metaphor lands before building the hedgehog.
- **After Slice 5** — affinity router open-beta to a handful of operators. Tune threshold.
- **After Slice 7** — public flag-flip candidate. Feedback routing is the moment Hedgemony delivers obvious value over plain Inbox.
- **After Slice 9** — v1 ship. Slice 10 is polish for v1.1.

The open product questions in `spec.md` (nest placement auto vs manual, idle hoglet TTL, renderer direction/budget, Inbox vs Hedgemony default) map to specific slices — don't try to answer them up front; let them surface where they bite. Manual placement in Slice 1, idle TTL in Slice 6, renderer choice when the map shell starts constraining the product.
