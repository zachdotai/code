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

| Game term                  | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | PostHog Code primitive                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Builder**                | A persistent hedgehog unit on the map. The only entry point for nest creation. Selecting it docks a command panel with two options: **Build nest** (guided conversational goal-writing flow → full spec + definition of done) and **Quick nest** (simple one-field form → minimal spec + immediate first hoglet). Either path enters build mode (crosshair, ghost circle following the pointer) so the operator clicks the ground to place. Builder itself is moved with right-click like any unit. | New — client-side unit, no sqlite row.                                                        |
| **Nest**                   | A goal, placed on the map like an AoE city. The operator creates it through the Builder, either via the guided conversational flow (full goal spec + definition of done) or the simple form (minimal name + prompt + auto-spawned first hoglet). Scope is inferred from the natural-language goal, grouped signals, and hoglet history; it does not have to be declared up front. Optionally tagged with a metric, but not required.                                                                | New — thin record referencing existing primitives.                                            |
| **Hibernacula**            | The data store behind a nest. sqlite tables (alongside posthog-code's existing `better-sqlite3` db at `apps/code/src/main/db/`) for structured state — nest config, hedgehog scratchpad, nest chat/audit log, PR dependency graph, operator-override memory, tick log, hoglet sidecar rows. Long-form context as markdown in the nest's worktree.                                                                                                                                                   | New tables in the existing sqlite db; existing worktree filesystem.                           |
| **Hedgehog**               | The nest's orchestrator. One per nest. Raises hoglets, tracks stacked PRs and their dependencies, routes review feedback + CI failures back to the originating hoglet, judges goal completion against the goal spec, and talks with the operator through nest chat. Ephemeral per-tick, re-instantiable from the hibernacula.                                                                                                                                                                       | Not a `Task`. A stateless function over persisted state, dispatched by `HedgehogTickService`. |
| **Hoglet**                 | The agent. A posthog-code task with a sidecar row in `hedgemony_hoglet` adding `nest_id` and `signal_report_id`. Tasks themselves are server-owned by PostHog Django and fetched via `PosthogAPIClient`.                                                                                                                                                                                                                                                                                            | Cloud Task + local sidecar row.                                                               |
| **Unnested signal hoglet** | A signal-backed hoglet that has not been grouped into a nest yet. It comes from the Signals Inbox and keeps `signal_report_id` set. Operator can group it into an existing nest, create a nest around related signals, or dismiss/suppress the underlying Inbox item.                                                                                                                                                                                                                               | `Task` with null nest binding and non-null `signal_report_id`.                                |
| **Wild hoglet**            | An operator-spawned ad-hoc one-off that does not fit a larger nest goal. It can ship and die, or be adopted later if it turns out to belong to a bigger objective.                                                                                                                                                                                                                                                                                                                                  | `Task` with null nest binding and null `signal_report_id`.                                    |
| **Prickle**                | Operator-selected group of hoglets. Ephemeral (drag-select / Ctrl+click).                                                                                                                                                                                                                                                                                                                                                                                                                           | Client-side selection over `Task`s.                                                           |

---

## The core loop

1. **Signal arrives in Inbox.** PostHog's signals pipeline emits a `SignalReport`; the Signals Inbox remains the source of truth for signal lifecycle, dedupe, suppression, and grouping metadata.
2. **Net-new signal work becomes a hoglet.** If the Inbox item represents net-new implementation work and is not already represented by a Task/hoglet, Hedgemony creates or adopts a `Task` with the report's title, summary, findings, suggested reviewers, and source context as the initial prompt.
3. **Auto-group by goal affinity.** Semantic similarity between the report and each active nest's goal spec, grouped signals, and recent hoglet history (HogQL `embedText` + similarity against `document_embeddings`). Highest match above threshold wins. No match → an unnested signal hoglet remains in the Inbox-backed staging area for the operator to group, dismiss, or form into a new nest.
4. **Hedgehog conducts.** Raise the hoglet (if still idle: start the cloud `TaskRun`), hold it (wait for siblings), message it, reassign it, or release it (write an operator-decision-style suppress and skip) within the permissions available to that hoglet.
5. **Hoglets work.** Each one is a normal posthog-code task — branch, worktree, harness, MCP, skills, all unchanged. Output: a PR.
6. **Hedgehog manages the brood.** Holds child PRs in a dependency graph, triggers rebases on parent merges, routes review comments + CI failures to the originating hoglet (or spawns a follow-up hoglet if the session is closed), watches the goal.
7. **Goal completes.** Hedgehog judges the goal spec and definition of done against accumulated work (merged PRs, resolved signal reports, optional metric movement) and proposes closing the nest. Operator confirms; nest goes dormant; hibernacula keeps a compact completion record while detail context becomes eligible for pruning.

---

## What the hedgehog actually owns

She's the load-bearing new concept:

- **Brood management** — spawns, raises, kills hoglets within the nest's loadout.
- **PR dependency graph** — knows which hoglet's PR depends on which; serializes merges; triggers rebases on parents landing.
- **Feedback routing** — review comments and CI failures land back on the right hoglet's task conversation, automatically.
- **Goal judgment** — reads the goal spec and definition of done, then decides when accumulated work satisfies it. If the operator tagged a metric, she watches it; otherwise she's reasoning over PRs + signals.
- **Nest chat + audit** — users talk to her in a nest-level chat, and every orchestration action gets a compact audit entry explaining what happened and why. The default surface shows orchestrator-level summaries; users can expand into the underlying hoglet messages/events when they want the full trail.
- **Persistent brain** — every decision-relevant piece of state (graph, roster, accumulated context, chat/audit log) lives in the hibernacula. She crashes and respawns cleanly.

Operator can override any decision — kill a hoglet, redirect, pause the nest, ship anyway. The hedgehog does not need approval for normal orchestration; her authority is bounded by the permissions, repo access, worktree access, and harness settings already attached to the hoglets she controls.

---

## Ad-hoc and wild

The map has three creation surfaces. They co-exist deliberately: the operator picks the path that matches the work, no forced funnel.

- **Builder → Build nest** (guided): conversational draft agent produces a full spec + definition of done before the nest row exists. Operator places the nest on the map. Hedgehog manages it.
- **Builder → Quick nest** (simple): one-field form, minimal nest, auto-spawned first hoglet inside it. For "this is real work but I'm not writing a spec for it."
- **Wild hoglet (ad-hoc)**: dedicated toolbar/keyboard action, separate from the Builder. Spawns a hoglet with `nest_id = null`, `signal_report_id = null`. Ships PR, dies. No hedgehog unless the operator later adopts it into a nest. For genuine one-offs that don't deserve a nest record at all.
- **No-match signal**: signal-backed hoglet appears in an Inbox-backed staging area, not the ad-hoc wild area. Operator groups it into a nest, spawns a new nest around related signals, or dismisses/suppresses the Inbox item.
- **Adoption**: any wild or unnested signal hoglet can be dragged into a nest; that nest's goal spec and inferred loadout apply from then on.

---

## Map controls (RTS conventions)

- **Left-click** on a unit (Builder, nest) selects it; selection ring appears. Click empty map to deselect.
- **Right-click** on empty map issues a move command for the selected unit. Animated slide + destination ripple marker.
- **Esc** clears selection, or cancels build mode if active.
- **Build mode**: triggered from the Builder's command panel. Crosshair cursor + dashed ghost circle follows the pointer; click ground to place; right-click or Esc cancels.

Drag-to-move on sprites is supported for nests as a faster alternative to right-click positioning. The Builder is right-click-only so its command panel doesn't get accidentally repositioned mid-drag.

### Movement feel

Unit motion should read as an RTS unit traversing terrain, not as a UI widget animating to a new state. Two rules:

1. **Constant world-space speed.** Travel duration is `distance / speed`, so a long move takes visibly longer than a short one. Use framer-motion's imperative `animate()` over `useMotionValue`s, never a spring keyed on position — springs settle in roughly the same time regardless of distance and feel like a snap. Current values: Builder ≈ 150 px/s (`BuilderSprite.tsx`), nests ≈ 100 px/s (`NestSprite.tsx`); nests are deliberately a bit slower so they read as heavier than the Builder.
2. **Smooth ease, no overshoot.** Use an ease-in-out cubic-bezier (`[0.4, 0, 0.2, 1]`) for nests; the Builder uses `linear` per-segment because its path is multi-waypoint and segment joins should not stutter.

While moving, the unit plays its **walk** sprite animation and the **facing direction flips from the sign of `dx`**; on arrival it returns to **idle**. Static sprites mid-flight kill the RTS read.

### Visual rules

- **Never draw connecting lines between hoglets (or between hoglets and nests).** That includes dashed, dotted, and solid SVG/CSS lines layered over the map for PR dependencies, parent/child relationships, prickle membership, or any other relational signal. They cut across the scenery, fight the hoglet sprites for attention, and look like total shit. Surface those relationships through the detail panels, sprite badges, or selection rings instead. We tried it once with `NestPrGraphOverlay` for PR dependency arrows and ripped it back out — don't reintroduce it.

---

## Persistence and runtime

**v1: local everything, schema built for cloud sync later.**

- All Hedgemony state lives in the existing posthog-code `better-sqlite3` db (new tables alongside the existing workspace/repository tables) plus markdown in each nest's worktree. Same backup, same lifecycle, no new infra.
- Schema is shaped for eventual cloud sync from day one: UUID primary keys, `created_at` / `updated_at` columns, soft-delete flags. The future migration to PostHog-cloud-backed storage is mechanical, not a rewrite.
- **Hedgehog chat is durable, but not her memory.** Nest chat is stored as a command/audit log. Each hedgehog tick assembles the current nest state, recent chat, compact summaries, and relevant hoglet events from storage. No long-running agent transcript is kept alive.
- **Completed nests compact before they disappear.** A dormant nest keeps the goal, definition of done, completion summary, task/PR handles, and concise audit trail. Large bootstrap handoffs, scratchpad entries, detail messages, and raw task logs are either summarized, capped, or referenced by external handles so SQLite does not grow without bound. A later explicit "forget" or retention job may prune detail rows, but it must preserve enough tombstone state that completed hoglets do not reappear as wild/unattached work.
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

- Map view with nests as placed bases, hoglets as units around them, plus unnested signal staging and ad-hoc wild one-offs.
- Affinity router by goal spec, grouped signals, and inferred repo/product/worktree context.
- Hedgehog: brood management, message passing, PR dependency graph, feedback routing, goal-spec judgment.
- Hibernacula: new sqlite tables + markdown in worktrees. Includes accumulated merged PRs and nest chat/audit log.
- Ad-hoc wild hoglets, unnested signal hoglets, and adoption into nests.
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
2. **Affinity threshold** — what's "good enough" to route a signal automatically vs leave it in Inbox-backed signal staging?
3. **Idle hoglet TTL** — when does the hedgehog give up on an unraised hoglet?
4. **Goal-completion confidence** — does the hedgehog always require operator confirmation to close a nest, or auto-close above some confidence?
5. **Renderer direction + budget** — are we shipping a lightweight map shell first, or committing to a game renderer; and how many simultaneous hoglets must it handle?
6. **Command Center default view** — when `HEDGEMONY_FLAG` / `hedgemony-enabled` is on, does Command Center open in grid mode or map mode? (Inbox vs Command Center placement is no longer an open — they're separate top-level views.)
7. **Retention defaults** — should dormant nest detail be compacted immediately, after a fixed TTL, or only on explicit operator action?
