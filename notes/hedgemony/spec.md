# Hedgemony — RTS for Autonomous Product Delivery

**Pitch:** Age of Empires taught a generation to manage cities and the territory between them. Hedgemony teaches Gen Z to manage fleets of agents the same way. Your agents, your signals, one map.

Hedgemony is a new view mode inside **Command Center**, sibling to its existing up-to-9 grid of parallel sessions. Command Center is the window manager; Hedgemony is a spatial command surface on top of the same primitives — nests sit on the map like cities, agents do the work around them. **Inbox** (signal-driven autopilot list) remains its own top-level view alongside Command Center.

Inspired by AgentCraft. Hedgemony is the PostHog-Code-native version, grounded in primitives that already exist.

---

## What it needs to do

1. **Signals → goal**: an incoming signal spawns an agent that auto-routes to a relevant goal.
2. **Goal-driven swarms**: declare an objective as a freeform prompt, pre-load it with context/skills/MCPs/docs, spawn agents against it.
3. **Ad-hoc agents**: spawn an agent without a goal for one-off work.
4. **Visualize**: see every agent and every goal in one view.

---

## Vocabulary

| Game term | What it is | PostHog Code primitive |
|---|---|---|
| **Nest** | A goal, placed on the map like an AoE city. Goal is a freeform prompt — the operator just writes what they want. Holds a loadout: skills, MCP servers, doc references, optional target metric. No repo field — repo membership is derived from a nest's hoglets. | New — thin record referencing existing primitives. |
| **Hibernacula** | The data store behind a nest. sqlite tables (alongside posthog-code's existing `better-sqlite3` db at `apps/code/src/main/db/`) for structured state — nest config, hedgehog scratchpad, PR dependency graph, operator-override memory, tick log, hoglet sidecar rows. Long-form context as markdown in the nest's worktree. | New tables in the existing sqlite db; existing worktree filesystem. |
| **Hedgehog** | The nest's orchestrator. One per nest. Raises hoglets, tracks stacked PRs and their dependencies, routes review feedback + CI failures back to the originating hoglet, judges goal completion against the freeform prompt. Ephemeral per-tick, re-instantiable from the hibernacula. | Not a `Task`. A stateless function over persisted state, dispatched by `HedgehogTickService`. |
| **Hoglet** | The agent. A posthog-code task with a sidecar row in `hedgemony_hoglet` adding `nest_id` and `signal_report_id`. Tasks themselves are server-owned by PostHog Django and fetched via `PosthogAPIClient`. | Cloud Task + local sidecar row. |
| **Wild hoglet** | A hoglet with no `nest_id`. Two origins: a signal that found no matching nest, or an operator-spawned ad-hoc agent. Operator can adopt it into a nest, or let it ship and die. | `Task` with null nest binding. |
| **Prickle** | Operator-selected group of hoglets. Ephemeral (drag-select / Ctrl+click). | Client-side selection over `Task`s. |

---

## The core loop

1. **Signal arrives + autonomy spawns a Task.** PostHog's signals pipeline emits a `SignalReport`; the existing **autonomy** system auto-starts a cloud Task from high-priority reports. Hedgemony does *not* duplicate that ingestion.
2. **Hedgemony adopts the task.** A polling adoption loop notices autonomy-started tasks tied to not-yet-adopted reports, inserts a `hedgemony_hoglet` sidecar row binding the task to a nest (via the affinity router) or to the wild-hoglet holding area if no nest matches.
3. **Auto-route by goal affinity.** Semantic similarity between the report and each active nest's `goal_prompt` (HogQL `embedText` + similarity against `document_embeddings`). Highest match above threshold wins. No match → `nest_id = null` (wild hoglet).
4. **Hedgehog decides.** Raise the hoglet (if still idle: start the cloud `TaskRun`), hold it (wait for siblings), or release it (write an operator-decision-style suppress and skip).
5. **Hoglets work.** Each one is a normal posthog-code task — branch, worktree, harness, MCP, skills, all unchanged. Output: a PR.
6. **Hedgehog manages the brood.** Holds child PRs in a dependency graph, triggers rebases on parent merges, routes review comments + CI failures to the originating hoglet (or spawns a follow-up hoglet if the session is closed), watches the goal.
7. **Goal completes.** Hedgehog judges the freeform goal against accumulated work (merged PRs, resolved signal reports, optional metric movement) and proposes closing the nest. Operator confirms; nest goes dormant; hibernacula keeps the record.

---

## What the hedgehog actually owns

She's the load-bearing new concept:

- **Brood management** — spawns, raises, kills hoglets within the nest's loadout.
- **PR dependency graph** — knows which hoglet's PR depends on which; serializes merges; triggers rebases on parents landing.
- **Feedback routing** — review comments and CI failures land back on the right hoglet's task conversation, automatically.
- **Goal judgment** — reads the freeform goal prompt and decides when accumulated work satisfies it. If the operator tagged a metric, she watches it; otherwise she's reasoning over PRs + signals.
- **Persistent brain** — every decision-relevant piece of state (graph, roster, accumulated context) lives in the hibernacula. She crashes and respawns cleanly.

Operator can override any decision — kill a hoglet, redirect, pause the nest, ship anyway.

---

## Ad-hoc and wild

- **Ad-hoc agent**: operator clicks empty map → wild hoglet spawns with operator-provided prompt. Ships PR, dies. No hedgehog.
- **No-match signal**: hoglet appears in a wild-hoglet holding area. Operator drags it into a nest (adopt), spawns a new nest around it, or dismisses it.
- **Adoption**: any wild hoglet can be dragged into a nest; that nest's loadout applies from then on.

---

## Persistence and runtime

**v1: local everything, schema built for cloud sync later.**

- All Hedgemony state lives in the existing posthog-code `better-sqlite3` db (new tables alongside the existing workspace/repository tables) plus markdown in each nest's worktree. Same backup, same lifecycle, no new infra.
- Schema is shaped for eventual cloud sync from day one: UUID primary keys, `created_at` / `updated_at` columns, soft-delete flags. The future migration to PostHog-cloud-backed storage is mechanical, not a rewrite.
- **Cloud hoglets are free.** A hoglet wraps a `Task`; whether that Task's TaskRun is `environment: local` or `environment: cloud` is invisible to Hedgemony. Cloud sandboxes keep running while posthog-code is closed; SSE reconnects on reopen.
- **The local hedgehog is the v1 limitation.** When posthog-code is closed she's asleep, so cloud hoglet PRs landing at 3am aren't orchestrated until you reopen the app. Nothing is lost (SSE catches her up), but orchestration was paused.
- **Cross-machine visibility is unsolved in v1.** Task records are local; switching machines means losing your nest handles. This is already true of cloud tasks today — Hedgemony inherits it, doesn't worsen it.

**v2: pull pieces into the cloud as the local limits bite.**

- **Cloud-side hedgehog** is the big unlock — orchestrator runs server-side, reacts to PRs / CI / review comments in real time, no laptop-closed pause. This is when "long-running goal-pursuing nest" stops being aspirational.
- **Cloud-synced nest state** (config, hedgehog brain, hoglet roster) gives cross-machine visibility — open posthog-code anywhere, see your swarm.
- Both ride on top of the v1 schema; no rewrite required.

---

## v1 vs v2 (feature scope)

**v1**
- Map view with nests as placed bases, hoglets as units around them, wild hoglets in a holding area.
- Affinity router by topic / source_products / repo.
- Hedgehog: brood management, PR dependency graph, feedback routing, freeform goal judgment.
- Hibernacula: new sqlite tables + markdown in worktrees. Includes accumulated merged PRs.
- Ad-hoc wild hoglets, wild-hoglet adoption.
- Prickle (ephemeral drag-select).

**v2**
- Cloud-side hedgehog + cloud-synced nest state (see Persistence and runtime).
- Operator-tagged target metric watched live by the hedgehog.
- Mid-flight nest re-planning when the signal landscape shifts.
- Review bundles as a first-class surface (review all of a nest's PRs as one).
- Cross-nest hedgehog coordination on overlapping signals.

---

## Out of scope (v1)

Persistent hoglet identity / cosmetics, multiplayer, voice lines, cloud-vs-local visual distinction (posthog-code already owns it), re-implementing the task framework, harness selection, branch management, or the signals pipeline.

---

## Open questions

1. **Nest placement on the map** — operator-placed, or auto-arranged by topic/repo clustering?
2. **Affinity threshold** — what's "good enough" to route a signal automatically vs send it to the wild zone?
3. **Idle hoglet TTL** — when does the hedgehog give up on an unraised hoglet?
4. **Goal-completion confidence** — does the hedgehog always require operator confirmation to close a nest, or auto-close above some confidence?
5. **Render budget** — how many simultaneous hoglets before DOM strains and we need a canvas layer?
6. **Command Center default view** — when `hedgemonyEnabled`, does Command Center open in grid mode or map mode? (Inbox vs Command Center placement is no longer an open — they're separate top-level views.)
