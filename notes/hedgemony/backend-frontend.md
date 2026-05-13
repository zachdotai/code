# Hedgemony — Backend ↔ Frontend

How Hedgemony's main-process backend exposes itself to the renderer. Companion doc: [backend-integration.md](./backend-integration.md). Product spec: [spec.md](./spec.md).

Assumes the data model and services from the backend-integration doc.

---

## View placement

Hedgemony is a view mode *inside* Command Center, sibling to its existing 9-grid mode. Command Center owns the route; the user toggles between "grid" and "map" within the same surface. Inbox remains its own top-level view alongside Command Center.

Folder: `apps/code/src/renderer/features/hedgemony/` (sibling feature folder, matching `features/inbox`, `features/command-center`, etc.). Command Center imports the map view from here. Kept as a sibling rather than nested under `features/command-center/` because Hedgemony has its own stores, tRPC router, and services — nesting would bloat Command Center and complicate eventual extraction.

**Command Center changes required (~60 lines + new components)**, behind the feature flag so the flag-off behavior is unchanged:

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
- `nests.get(id)` → full nest with loadout, hedgehog state summary, hoglet sidecar rows, PR dep graph, recent feedback events. Task state for hoglets is **not** included — the renderer fetches Task state separately via the existing `PosthogAPIClient.getTasks` (batched) and merges client-side.
- `nests.create(input)` → returns the new nest row. **No hedgehog "Task" is spawned** — the hedgehog is not a Task; the `HedgehogTickService` simply starts scheduling ticks for the new nest.
- `nests.update(id, patch)` → goal prompt, loadout, map position.
- `nests.archive(id)` / `nests.unarchive(id)`.
- `hoglets.list({ nestId?, wildOnly? })` → returns `hedgemony_hoglet` rows. Renderer joins with Task state from `PosthogAPIClient`.
- `hoglets.adopt(hogletId, nestId)` / `hoglets.release(hogletId)`.
- `hoglets.spawnAdhoc({ prompt, repo })` → triggers the existing task-creation saga, then inserts a `hedgemony_hoglet` row with `nest_id = null`.

**Mutations**: covered above. All Hedgemony writes go through the router — renderer never touches the sqlite repositories directly.

**Subscriptions** (per-service `TypedEventEmitter`s in main, exposed via tRPC observables):
- `nests.watch(id)` → emits on nest status change, hoglet roster change, hedgehog tick completion.
- `hoglets.watch(nestId)` → emits on `hedgemony_hoglet` row changes. Renderer separately listens to Task state changes via the existing PostHog API session/SSE.
- `feedback.watch(nestId)` → emits each routed feedback event for the activity feed.
- `hedgemony.onInjectPrompt` → emitted by `FeedbackRoutingService` when a PR review comment needs to land in a hoglet's session. Consumed by `useHedgemonyPromptRouter()` (mounted once at app level), which calls the existing `sendPromptToAgent` for connected sessions, or `nests.spawnFollowUpHoglet` for closed sessions. Mirrors `useInboxDeepLink` → `InboxLinkService` exactly.

Renderer connects subscriptions for the active view only (except `onInjectPrompt`, which is always-on at app level); closes them on view exit.

---

## Zustand stores

Mirrors the Command Center pattern (`apps/code/src/renderer/features/command-center/stores/`). One feature, several small stores:

| Store | Holds |
|---|---|
| `nestStore` | List of nests, fetch/refresh state, map placements. Driven by `nests.list` + `nests.watch`. |
| `hogletStore` | Hoglet roster keyed by `nestId` (plus a special `wild` key). Driven by `hoglets.list` + `hoglets.watch`. |
| `selectionStore` | The current prickle — ephemeral set of selected hoglet IDs, plus hotkey group bindings (`ctrl+1/2/3`). Pure client state. |
| `hedgemonyViewStore` | UI state: zoom, pan offset, active panel, holding-area open/closed. Pure client state. |
| `loadoutDraftStore` | Optimistic edits to a nest's loadout before save. |

All Hedgemony stores live under `features/hedgemony/stores/`. None of them are shared with non-Hedgemony features.

---

## Map rendering

DOM-based. Nests, hoglets, and the holding area are absolutely-positioned React components. Animations via Framer Motion or CSS transitions. Hit-testing via the React event tree.

Render-budget cap: clamp visible hoglets to N (TBD, prob 50ish) with overflow rolled up into a "+12 more" badge per nest. Stores stay rendering-agnostic — if the budget bites later, a canvas layer can drop in behind the same store shape.

See [Considered alternatives](#considered-alternatives) for the canvas option.

---

## Selection model (prickle)

- **Drag-select**: pointer-down on empty map → draw selection box → all hoglets intersected go into `selectionStore.selected`.
- **Ctrl+click**: toggle individual.
- **Hotkey groups**: `Ctrl+1/2/3` binds current selection; `1/2/3` recalls.
- **Group ops** dispatched from selection: dispatch to nest, adopt to nest, kill, send custom prompt batched across hoglets.
- Selection is purely client-side — never persisted, never sent to main process.

---

## Loadout editor

Per-nest panel for editing the loadout — goal prompt, skills enabled, MCP servers, doc references, optional target metric. Mirrors the existing settings UI patterns (`features/settings/components/sections/`).

Edits live in `loadoutDraftStore` optimistically; "Save" flushes via `nests.update`. The loadout drives what gets passed to every hoglet the hedgehog spawns from that nest — there's no per-hoglet customization at spawn time (operator can still send custom prompts to individual hoglets via the existing task UI).

---

## Wild hoglet holding area

A persistent off-map UI region (left rail or bottom drawer, TBD) showing every hoglet with `nest_id = null`. Each row exposes:

- The signal report it came from (if any).
- "Adopt to nest" picker.
- "Spawn new nest around this" shortcut.
- "Dismiss" (marks the originating report `suppressed`).

Driven by `hoglets.list({ wildOnly: true })` + `hoglets.watch`.

---

## Hoglet visualization state

Visual state derives entirely from existing posthog-code primitives — no Hedgemony-specific Task mirror table. Task state for each hoglet is fetched via `PosthogAPIClient.getTasks` (batched) and merged client-side with the `hedgemony_hoglet` rows from sqlite.

| Hoglet visual | Source |
|---|---|
| Idle (not yet raised) | cloud `Task.status = not_started` |
| Working | cloud `TaskRun.status = in_progress` |
| Has open PR | `getTaskPrStatus → "open"` or `"draft"` |
| Blocked on review | open PR + unresolved review comments (polled via existing github-integration service) |
| Blocked on CI | open PR + `failed` CI status |
| Done | cloud `TaskRun.status = completed` and PR merged |
| Failed | cloud `TaskRun.status = failed` |
| Orphaned | local `hedgemony_hoglet` row exists but cloud Task API returns 404 (flagged by [recovery sweep](./backend-integration.md#recovery--consistency-sweep)) |

The hedgehog is not a Task. Her visual status is read directly from `hedgemony_hedgehog_state.state` (`idle` / `ticking` / `proposing-completion`) plus the `last_tick_at` heartbeat for "alive within recent N min" indicators.

---

## Telemetry

Reuse `apps/code/src/renderer/utils/analytics.ts`. New events under a `hedgemony.*` prefix:

- `hedgemony.nest_created`, `hedgemony.nest_archived`
- `hedgemony.hoglet_spawned` (with `source: signal | adhoc`)
- `hedgemony.hoglet_adopted`, `hedgemony.hoglet_dismissed`
- `hedgemony.hedgehog_raised_hoglet`, `hedgemony.hedgehog_proposed_completion`
- `hedgemony.feedback_routed` (with `source: pr_review | ci`)
- `hedgemony.pr_dependency_satisfied`, `hedgemony.pr_dependency_rebased`

Keep telemetry namespaced so it's trivially filterable and can be ripped out cleanly if Hedgemony is extracted.

---

## Open product decisions

These are real product/UX opens that need owners; not implementation choices.

1. **Holding-area placement** — left rail (persistent), bottom drawer (collapsible), or floating panel. Affects perceived priority of wild hoglets.
2. **Hedgehog as a visible unit** — does she render on the map next to her nest, or is she implicit (the nest itself glows when she's active)?
3. **Map persistence** — is `map_x` / `map_y` operator-placed (drag a nest where you want it) or auto-arranged (force-directed)?

Implementation choices locked in v1:

- **Rendering**: DOM (see [Map rendering](#map-rendering)).
- **Cross-view linking**: clicking a hoglet jumps to the existing posthog-code task detail view; back returns to the map with state preserved (zoom, selection, scroll). Standard router-with-state-preservation pattern.

---

## Considered alternatives

### Canvas-based map rendering

We considered `react-konva` or `pixi-react` for the map layer. Pros: scales to hundreds of units, smoother animations. Cons: extra dep, custom hit-testing, bespoke accessibility, harder to reuse existing Radix components. Rejected for v1 — DOM with a render-budget cap handles the expected hoglet counts. Path to swap is open since stores are rendering-agnostic.
