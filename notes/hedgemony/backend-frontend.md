# Hedgemony — Backend ↔ Frontend

How Hedgemony's main-process backend exposes itself to the renderer. Companion doc: [backend-integration.md](./backend-integration.md). Product spec: [spec.md](./spec.md).

Assumes the data model and services from the backend-integration doc.

---

## View placement

Hedgemony is a view mode _inside_ Command Center, sibling to its existing 9-grid mode. Command Center owns the route; the user toggles between "grid" and "map" within the same surface. Inbox remains its own top-level view alongside Command Center.

Folder: `apps/code/src/renderer/features/hedgemony/` (sibling feature folder, matching `features/inbox`, `features/command-center`, etc.). Command Center imports the map view from here. Kept as a sibling rather than nested under `features/command-center/` because Hedgemony has its own stores, tRPC router, and services — nesting would bloat Command Center and complicate eventual extraction.

**Command Center changes required (~60 lines + new components)**, behind `HEDGEMONY_FLAG = "hedgemony-enabled"` from `@shared/constants` so the flag-off behavior is unchanged:

- `commandCenterStore.ts` — add `viewMode: "grid" | "map"` field + setter. Existing cell-indexed actions (`assignTask`, `removeTask`, `setActiveCell`, etc.) stay; they're no-ops in map mode.
- `CommandCenterView.tsx` — branch on `viewMode`: render the existing grid in `"grid"`, render `<HedgemonyMap />` (imported from `features/hedgemony/`) in `"map"`.
- `CommandCenterToolbar.tsx` — add a `"grid" | "map"` segmented toggle next to the existing layout-preset `Select.Root`. In map mode, hide the grid-specific chrome (layout, zoom, clear-cell, stop-all).
- Persisted state: `viewMode` survives reload; default `"grid"` for users who haven't opted into map mode.

**Tradeoff acknowledged**: Command Center's store is cell/grid-shaped to its core (`activeCellIndex`, `creatingCells: number[]`, cell-indexed persistence). Map mode doesn't use any of it, so map-mode renders with several store fields permanently null/unused. This was an explicit product call — keeps Hedgemony discoverable next to the existing parallel-agent-management surface rather than buried in its own sidebar entry. If the friction becomes real, the alternative ("own top-level view alongside Inbox + Command Center") is a ~70-line glue change against `navigationStore.ts: ViewType` + `MainLayout.tsx` + sidebar.

---

## tRPC routers + subscriptions

One new router: `apps/code/src/main/trpc/routers/hedgemony.ts`. Mirrors the shape of existing routers (`inbox.ts`, `workspace.ts`, etc.).

**Queries:**

- `nests.list()` → all active nests + their hoglet counts + status (local sqlite only — no Task fetch).
- `nests.get(id)` → full nest with goal spec, loadout, hedgehog state summary, hoglet sidecar rows, PR dep graph, recent feedback events, recent nest chat/audit summaries. Task state for hoglets is **not** included — the renderer fetches Task state separately via the existing `PosthogAPIClient.getTasks` (batched) and merges client-side.
- `goalDraft.respond({ messages, currentDraft? })` → bounded goal-writing draft agent. Returns either a clarifying assistant question or an editable draft `{ name, goalPrompt, definitionOfDone }`. Stateless over the provided transcript; no persisted draft row.
- `nests.create(input)` → returns the new nest row. Input includes the accepted draft fields plus optional `creationTranscript`. **No hedgehog "Task" is spawned** — the hedgehog is not a Task; later slices let `HedgehogTickService` schedule ticks for active nests.
- `nests.update(id, patch)` → goal prompt/spec, definition of done, loadout, map position.
- `nests.archive(id)` / `nests.unarchive(id)`.
- `hoglets.list({ nestId?, wildOnly?, unnestedSignalsOnly? })` → returns `hedgemony_hoglet` rows. Renderer joins with Task state from `PosthogAPIClient`. `wildOnly` means ad-hoc one-offs (`signal_report_id = null`); `unnestedSignalsOnly` means Inbox-backed signal hoglets (`signal_report_id IS NOT NULL`).
- `hoglets.adopt(hogletId, nestId)` / `hoglets.release(hogletId)`.
- `hoglets.spawnAdhoc({ prompt, repo? })` → triggers the existing task-creation saga, then inserts a `hedgemony_hoglet` row with `nest_id = null` and `signal_report_id = null`.
- `nestChat.list({ nestId, detail? })` → recent nest chat/audit entries. `detail = false` returns orchestrator-level summaries; `detail = true` includes expandable tool/hoglet detail rows.
- `nestChat.send({ nestId, message })` → writes a user message and enqueues an immediate hedgehog tick for that nest.

**Mutations**: covered above. All Hedgemony writes go through the router — renderer never touches the sqlite repositories directly.

**Subscriptions** (per-service `TypedEventEmitter`s in main, exposed via tRPC observables):

- `nests.watch(id)` → emits on nest status change, hoglet roster change, hedgehog tick completion.
- `hoglets.watch(nestId)` → emits on `hedgemony_hoglet` row changes. Renderer separately listens to Task state changes via the existing PostHog API session/SSE.
- `feedback.watch(nestId)` → emits each routed feedback event for the activity feed.
- `nestChat.watch(nestId)` → emits new chat/audit rows. The active nest panel subscribes in summary mode; expanded detail panels fetch detail rows on demand.
- `hedgemony.onInjectPrompt` → emitted by `FeedbackRoutingService` when a PR review comment needs to land in a hoglet's session. Consumed by `useHedgemonyPromptRouter()` (mounted once at app level), which calls the existing `sendPromptToAgent` for connected sessions, or `nests.spawnFollowUpHoglet` for closed sessions. Mirrors `useInboxDeepLink` → `InboxLinkService` exactly.

Renderer connects subscriptions for the active view only (except `onInjectPrompt`, which is always-on at app level); closes them on view exit.

---

## Zustand stores

Mirrors the Command Center pattern (`apps/code/src/renderer/features/command-center/stores/`). One feature, several small stores:

| Store                | Holds                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `nestStore`          | List of nests, fetch/refresh state, map placements. Driven by `nests.list` + `nests.watch`.                                         |
| `hogletStore`        | Hoglet roster keyed by `nestId` (plus special `wild` and `unnestedSignals` keys). Driven by `hoglets.list` + `hoglets.watch`.       |
| `nestChatStore`      | Nest-scoped chat/audit summaries, detail expansion state, pending user message state. Driven by `nestChat.list` + `nestChat.watch`. |
| `selectionStore`     | The current prickle — ephemeral set of selected hoglet IDs, plus hotkey group bindings (`ctrl+1/2/3`). Pure client state.           |
| `hedgemonyViewStore` | UI state: zoom, pan offset, active panel, holding-area open/closed. Pure client state.                                              |
| `loadoutDraftStore`  | Optimistic edits to a nest's loadout before save.                                                                                   |

All Hedgemony stores live under `features/hedgemony/stores/`. None of them are shared with non-Hedgemony features.

---

## Nest chat + audit surface

Each nest has a chat panel backed by `hedgemony_nest_message`. The UI can reuse the existing task conversation components where practical, but the runtime is not a Task conversation: user messages write to the nest command log and trigger a hedgehog tick.

Default view is concise:

- User messages.
- Hedgehog replies.
- Audit entries for orchestration actions, especially spawning hoglets, raising/killing hoglets, rebases, routed feedback, and proposed completion.

Detail is expandable:

- "Show details" on an audit entry reveals tool payloads, linked hoglet messages, PR/CI refs, and source signal reports.
- Hoglet conversation excerpts are summarized by default, with links into the existing Task detail view for the full transcript.
- The panel opens with recent audit context so an operator can quickly answer "what has this hedgehog been doing and why?"

Nest creation starts with a separate, bounded conversational goal-writing flow. The renderer keeps the unsaved transcript locally and calls `goalDraft.respond` for the next question or draft. When the operator accepts the draft, `nests.create` persists the nest row, writes the accepted transcript into `hedgemony_nest_message` as creation context, and, when the draft inferred repository exploration, records a local-only bootstrap handoff. That handoff is produced by the main process: it matches mentioned repos against local folders, clones missing `org/repo` refs into PostHog Code's configured storage, registers cloned folders, and stores bounded project-file summaries plus unresolved repo notes for the future ephemeral hedgehog. This is deliberately not `nestChat.send`: no hedgehog tick, tools inside the draft LLM call, hoglets, or autonomous implementation happen during goal drafting.

The flow asks enough questions to produce a lightweight goal spec and definition of done, but always exposes an "eject to simple form" path for operators who just want name + rough goal.

---

## Map rendering

Rendering engine is intentionally not locked yet. The shared contract is a map surface fed by the same tRPC queries, Zustand stores, and nest/hoglet/chat models whether the final renderer is DOM, Pixi, Godot, or something else.

Early slices can use a plain React pan/zoom shell to prove placement, empty state, and store wiring. That shell is scaffolding, not the product rendering decision.

Renderer-facing stores stay engine-agnostic. If the budget or product direction pushes us toward Pixi/Godot, the map implementation can swap while keeping `nestStore`, `hogletStore`, `nestChatStore`, and `hedgemonyViewStore` intact.

---

## Builder unit + map controls

The Builder is a client-side hedgehog unit persistent on the map. No sqlite row; position lives in renderer state. It's the only entry point for nest creation; ad-hoc wild hoglet spawn is a separate toolbar/keyboard action.

**RTS controls:**

- **Left-click** a unit (Builder, nest) → select it; selection ring appears. Click empty map → deselect.
- **Right-click** empty map with a unit selected → issue move command. Animated slide + destination ripple marker.
- **Esc** → clears selection, or cancels build mode if active.

**BuilderCommandPanel** (docks at bottom of map when Builder is selected) exposes two buttons:

- **Build nest** (guided): triggers `GoalSpecDraftService` conversational flow, then enters build mode for placement.
- **Quick nest** (simple): one-field form for prompt (name optional), then enters build mode; on placement, `nests.create` runs with `creationMode: "quick"` and an atomic first-hoglet spawn.

**Build mode UX:** crosshair cursor + dashed ghost circle following the pointer + top banner indicating "Click to place nest, Esc to cancel." Click empty ground places; right-click or Esc cancels.

**Why Builder is right-click-only for movement** (not drag): the command panel docks below the unit when selected; allowing drag on the Builder leads to accidental repositioning while the operator reaches for the panel. Nest sprites support drag-to-move as a faster alternative to right-click — they have no docked panel to interfere with.

---

## Selection model (prickle)

- **Drag-select**: pointer-down on empty map → draw selection box → all hoglets intersected go into `selectionStore.selected`.
- **Ctrl+click**: toggle individual.
- **Hotkey groups**: `Ctrl+1/2/3` binds current selection; `1/2/3` recalls.
- **Group ops** dispatched from selection: dispatch to nest, adopt to nest, kill, send custom prompt batched across hoglets.
- Selection is purely client-side — never persisted, never sent to main process.

---

## Loadout editor

Per-nest panel for editing the goal spec/loadout — goal prompt, definition of done, skills enabled, MCP servers, doc references, optional target metric. Mirrors the existing settings UI patterns (`features/settings/components/sections/`).

Edits live in `loadoutDraftStore` optimistically; "Save" flushes via `nests.update`. The loadout drives what gets passed to every hoglet the hedgehog spawns from that nest — there's no per-hoglet customization at spawn time (operator can still send custom prompts to individual hoglets via the existing task UI).

---

## Unnested signal staging + wild one-offs

A persistent off-map UI region (left rail or bottom drawer, TBD) has two sections:

**Unnested signals** — Inbox-backed signal hoglets with `nest_id = null` and `signal_report_id` set. Each row exposes:

- The signal report link + summary.
- "Adopt to nest" picker.
- "Spawn new nest around this" shortcut.
- "Dismiss" (marks the originating report `suppressed`).

**Wild one-offs** — ad-hoc hoglets with `nest_id = null` and `signal_report_id = null`. Each row exposes:

- Prompt/title and current Task status.
- "Adopt to nest" picker.
- "Let it finish as one-off" / "Cancel".

Driven by `hoglets.list({ unnestedSignalsOnly: true })`, `hoglets.list({ wildOnly: true })`, and `hoglets.watch`.

---

## Hoglet visualization state

Visual state derives entirely from existing posthog-code primitives — no Hedgemony-specific Task mirror table. Task state for each hoglet is fetched via `PosthogAPIClient.getTasks` (batched) and merged client-side with the `hedgemony_hoglet` rows from sqlite.

| Hoglet visual         | Source                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Idle (not yet raised) | cloud `Task.status = not_started`                                                                                                                      |
| Working               | cloud `TaskRun.status = in_progress`                                                                                                                   |
| Has open PR           | `getTaskPrStatus → "open"` or `"draft"`                                                                                                                |
| Blocked on review     | open PR + unresolved review comments (polled via existing github-integration service)                                                                  |
| Blocked on CI         | open PR + `failed` CI status                                                                                                                           |
| Done                  | cloud `TaskRun.status = completed` and PR merged                                                                                                       |
| Failed                | cloud `TaskRun.status = failed`                                                                                                                        |
| Orphaned              | local `hedgemony_hoglet` row exists but cloud Task API returns 404 (flagged by [recovery sweep](./backend-integration.md#recovery--consistency-sweep)) |

The hedgehog is not a Task. Her visual status is read directly from `hedgemony_hedgehog_state.state` (`idle` / `ticking` / `proposing-completion`) plus the `last_tick_at` heartbeat for "alive within recent N min" indicators.

---

## Telemetry

Reuse `apps/code/src/renderer/utils/analytics.ts`. New events under a `hedgemony.*` prefix:

- `hedgemony.nest_created`, `hedgemony.nest_archived`
- `hedgemony.hoglet_spawned` (with `source: signal | adhoc`)
- `hedgemony.hoglet_adopted`, `hedgemony.hoglet_dismissed`
- `hedgemony.nest_chat_message_sent`, `hedgemony.nest_chat_detail_expanded`
- `hedgemony.hedgehog_raised_hoglet`, `hedgemony.hedgehog_proposed_completion`
- `hedgemony.hedgehog_audit_entry_written`
- `hedgemony.feedback_routed` (with `source: pr_review | ci`)
- `hedgemony.pr_dependency_satisfied`, `hedgemony.pr_dependency_rebased`

Keep telemetry namespaced so it's trivially filterable and can be ripped out cleanly if Hedgemony is extracted.

---

## Open product decisions

These are real product/UX opens that need owners; not implementation choices.

1. **Holding-area placement** — left rail (persistent), bottom drawer (collapsible), or floating panel. Affects perceived priority of unnested signals and ad-hoc wild hoglets.
2. **Hedgehog as a visible unit** — does she render on the map next to her nest, or is she implicit (the nest itself glows when she's active)?
3. **Map persistence** — is `map_x` / `map_y` operator-placed (drag a nest where you want it) or auto-arranged (force-directed)?

Implementation choice locked in v1:

- **Cross-view linking**: clicking a hoglet jumps to the existing posthog-code task detail view; back returns to the map with state preserved (zoom, selection, scroll). Standard router-with-state-preservation pattern.

---

## Considered alternatives

### Map renderer

Renderer choice is deliberately deferred. The current notes in [ui-tech-options.md](./ui-tech-options.md) keep the live comparison: Pixi for a fast 2D prototype, Godot if Hedgemony becomes a full RTS, and a hybrid path if we want a cheap shell before committing to the engine.
