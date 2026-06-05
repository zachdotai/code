# Canvas / Dashboards — Progress & MVP gaps

Generative-UI dashboards built from real PostHog data, wrapped in a Slack-like
multi-space shell. **Everything is gated behind the `project-bluebird` feature
flag** (default-on in dev, off for all prod users → app is byte-for-byte the
current code-only shell). Not enabled for real users.

## Branches / PRs

- **`feat/canvas`** — the full feature (this doc). Draft **PR #2492**.
- **`code/top-nav`** — minimal extraction of just the nav rail (Home/Inbox/Code,
  Home empty), for a clean first landing. **PR #2491**.

## Shell / navigation

- **App nav rail** — Slack-like left rail (Home / Inbox / Code). Reserves macOS
  traffic-light space (2.5rem top padding); draggable titlebar region. Inbox
  button shows a live actionable-report count badge (`useInboxSignalCount`).
  - On `feat/canvas`: `features/canvas/components/CanvasNav.tsx`.
  - On `code/top-nav`: `components/AppNav.tsx` (Home routes to `/code` for now).
- **Inbox** — top-level `/inbox` renders `InboxView` full-screen.
- **Home space** (`/website/*`) — its own `HomeSidebar` listing **channels**.
- Root layout (`routes/__root.tsx`) gates the rail + branches on the flag:
  settings (full-screen), inbox (full-screen), home (rail + HomeSidebar), code
  (existing chrome). When the flag is off, `/` and `/inbox` redirect to `/code`
  once flags resolve (`useFeatureFlagsLoaded`).

## Channels (server-backed)

Replaces the old placeholder Website/Features/Resources nav. A "channel" is a
top-level folder on PostHog's **desktop file-system** surface.

- `posthogClient.ts` — `getDesktopFileSystem` / `createDesktopFileSystemChannel`
  / `deleteDesktopFileSystem`. `hooks/useChannels.ts` — list + create/delete.
- `HomeSidebar.tsx` — a "Channels" list with a Slack-style **create modal**
  (`CreateChannelModal.tsx`) and a per-channel hover `…` menu → destructive
  **delete**. Each channel is a collapsible section with active-route
  highlighting.
- **Each channel gets its own** dashboards, tasks, and settings, routed under
  **`/website/$channelId/...`** (`index` = dashboards grid, `dashboards/$id`,
  `new`, `tasks/$taskId`, `settings`). `/website` redirects to the first channel
  or an empty "create a channel" state.
- Channels require auth; logged-out shows an empty state.

## Dashboards (file-backed, channel-scoped)

- **Main `DashboardsService`** (`main/services/dashboards/`) — each dashboard is
  a JSON file `{id, channelId, name, spec, createdAt, updatedAt}` under
  `<appData>/dashboards/`. tRPC `dashboards.list(channelId) | get | create |
  update | delete | adoptOrphans | refresh`. `list` filters by `channelId`;
  `adoptOrphans` backfills pre-scoping dashboards into the first channel.
- **Index grid** (`WebsiteDashboardsIndex.tsx`) — 3-wide responsive card grid;
  each card shows a **live scaled-down preview** (`CanvasRenderer` at
  `scale(0.4)`), name, "updated" time, and a hover `…` menu → destructive
  **delete**. "New dashboard" creates a blank board and opens it in edit mode.
- Breadcrumbs (`WebsiteLayout.tsx`): `<channel> › Dashboards [› <name>]` /
  `New task` / `Settings`. No hardcoded "Website" root.

## Gen-UI engine

- `@json-render/core` + `@json-render/react`. Shared catalog (`genui/catalog.ts`:
  Page/Grid/Card/Heading/Text/Stat/Table/BarList/Badge/Divider) →
  `CANVAS_SYSTEM_PROMPT`.
- **Shared presentational bodies** (`genui/bodies.tsx`) — the JSX for every
  component lives once; `renderBody` dispatches by type. Both the view and edit
  renderers use them, so the surfaces are pixel-identical. `StatBody` formats raw
  numbers (`34980058 → 34,980,058`) at render.
- **View renderer** — `genui/registry.tsx` (`CanvasRenderer`, used for the grid
  thumbnails) and `genui/ViewRenderer.tsx` (key-aware walk used for the saved
  board, so each Card can carry a per-card refresh button).
- **Main `CanvasGenService`** reuses `AgentService` (PostHog MCP auto-enabled)
  via `systemPromptOverride`, runs an ephemeral `__preview__` session per thread
  with `bypassPermissions`, splits prose / json-render JSONL, assembles the spec,
  and streams typed events over a tRPC subscription. Renderer: multi-thread
  `canvasChatStore`, scoped subscription registrar, `CanvasChat` panel.

## Edit mode — direct manipulation

Entering Edit (`WebsiteDashboard.tsx`) seeds the canvas thread from the saved
spec (`ensureSpec`) and swaps to the gen-UI canvas + chat (`WebsiteCanvas.tsx`).

- **`genui/EditRenderer.tsx`** — recursive, key-aware walk (the map key is the
  element id, which `createRenderer` doesn't expose):
  - **Inline edit** of static text (titles/labels) via a contentEditable
    `InlineText` (commit on blur/Enter, revert on Escape).
  - **Drag-and-drop reorder** via `@dnd-kit/react` (`useSortable` grouped by
    parent); drop → `moveChild`.
  - **Locked data hint** — query-derived values show a "Data — from query"
    tooltip, not editable.
  - All affordances gated on `!isStreaming` so edits can't race agent snapshots.
- **`genui/editable.ts`** — the "interpreter": a prop is inline-editable iff it's
  an allow-listed static-text prop **and** a string literal (binding objects are
  auto-excluded).
- Spec edits mutate the live thread spec via `canvasChatStore`
  (`setElementProp`, `moveChild`); the existing dirty-diff drives **Save**.
- **Save** persists; **Save as fork** copies into a new dashboard; **Cancel**
  (the Edit button when active) resets the thread → discards all unsaved edits
  and the agent session; the file is untouched.

## Refreshable data — stored queries

Each data point's query lives **in the spec JSON** at
`spec.state.queries[elementKey][propPath] = { query: "<HogQL>" }` (values stay
literals in props, so rendering/editing are unchanged; forks stay refreshable).

- **Agent contract** (`catalog.ts`) — the agent records the single-row/single-col
  HogQL for every Stat value/delta alongside the literal it renders.
- **Main `DashboardQueryService`** (`main/services/dashboard-query/`) — runs each
  HogQL via `POST /api/projects/:id/query/` (auth via
  `authService.authenticatedFetch` → 401-refresh), capped parallelism, reduces to
  row 0 / col 0, per-point ok/fail (one bad query never fails the batch).
- **`dashboards.refresh(id, elementKeys?, touchUpdatedAt?)`** — atomic main
  read→run→patch→write: collects queries (subtree-filtered for per-card), runs
  them, patches `ok` values into the spec, **persists to the file**. Returns
  `{ updated, failures }`.
- **Renderer** — `hooks/useRefreshDashboard.ts` calls refresh + invalidates
  `dashboards.get` + toasts failures. The `DashboardRefreshControl` button now
  actually refreshes; polling passes `touchUpdatedAt:false` (no list reorder).
  `ViewRenderer` adds a **per-card** hover ↻ → `refresh([cardKey])`.

## What's left

1. **Agent reliability of `state.queries`.** If the agent omits the patch, that
   point silently stays unrefreshable (degrades to baked literal — safe). Needs
   live verification + prompt tuning; optional post-stream coverage warning.
2. **Table / BarList refresh** (array data) — not yet; needs a `shape:"rows"`
   query mode in `DashboardQueryService` + agent contract.
3. **Edit-mode live refresh** — refresh is view-mode only; edit mode renders the
   live store. A future enhancement refreshes via `setElementProp`.
4. **Verify the gen-UI agent end-to-end, live** against a real authed project:
   valid JSONL, MCP auto-approve under `bypassPermissions`, robust prose/JSONL
   split, no flooding.
5. **Persistence niceties.** Polling choice is per-mount local state; canvas chat
   threads aren't persisted (lost on reload); channel↔task membership is local
   (`websiteTasksStore`), not backend-bound.
6. **Tests.** None yet for the dashboards / dashboard-query / canvas-gen services,
   the stores, or the renderers.
7. **Settings** per channel is still an inert placeholder.

## Dev caveat

Main-process changes (new services/routers: `dashboards`, `dashboard-query`,
`canvas-gen`) require a **full dev restart** — renderer HMR won't load them.
Symptom when stale: a refresh/save no-op or `No "mutation"-procedure on path
"dashboards.refresh"`.
