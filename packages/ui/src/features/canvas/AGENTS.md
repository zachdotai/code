# Canvas (Website space) — patterns

Conventions for the channel-scoped Website space: channels, dashboards, and the
gen-UI canvas. Read this before changing breadcrumbs, dashboard naming, or the
canvas generation harness. The root `AGENTS.md` architecture rules still apply.

## Components & styling

- **Use `@posthog/quill`, not Radix.** New UI in this space pulls components from
  `@posthog/quill` (`Button`, `Dialog*`, `AlertDialog*`, `DropdownMenu*`,
  `ContextMenu*`, `Tooltip*`, `Collapsible*`, …). Do **not** reach for
  `@radix-ui/themes` or `@radix-ui/react-*`. Some older code here still imports
  `@radix-ui/themes` (`Box`, `Flex`, `Text`, `AlertDialog`) — that's legacy to be
  migrated, not a pattern to copy. When you touch such code, prefer swapping to
  the Quill equivalent.
- **Don't restyle Quill internals.** Quill components are already themed —
  spacing, typography, and especially **color** are baked in. Do not add
  `text-gray-*` / `text-muted-foreground` / `font-*` or other color/typography
  classes to elements *inside* a Quill component (menu items, dialog titles,
  buttons, etc.); you'll fight or override the design system and drift from every
  other surface. Trust the defaults. Layout-only utilities (`flex`, `gap`,
  width/`max-w`, `truncate`) on wrappers are fine; reach for `className` overrides
  on Quill items only when there is a real, deliberate exception — and call it out.
- **Suffix `…` on anything that opens another step.** A menu item or button whose
  click opens a follow-up surface — a dialog, a nested menu, a picker, a
  confirmation — gets a trailing ellipsis (`…`, the character, not three dots) to
  signal it isn't the final action: `New…`, `Rename channel…`, `Delete channel…`,
  `Choose a template…`. A label that performs its action immediately or navigates
  straight to a destination gets **no** ellipsis (`Edit CONTEXT.md`, `Star
  channel`). When in doubt: does clicking it ask for more input or confirmation
  before anything happens? If yes, add the `…`.

## Spaces & chrome

- Channels is a **top-level space** reached through the app rail (`AppNav`),
  gated behind `project-bluebird` and wired in `routes/__root.tsx`. The rail's
  spaces are Code (`/code`), Inbox (`/inbox`), and Channels (`/website`).
- The Channels space has **its own chrome**: rail + a persistent channel-list
  sidebar (`ChannelsList`, rendered in `__root`) + the `WebsiteLayout` outlet. It
  does NOT use the code `HeaderRow`/`MainSidebar`, so breadcrumbs render in
  `WebsiteLayout`'s own top bar (below).

## Breadcrumbs

- **`WebsiteLayout` renders its own top bar.** The Channels space has no code
  `HeaderRow`, so breadcrumbs (and the dashboard controls) are a local bar inside
  `WebsiteLayout`, not pushed through the header store.
- **A page does not get its own crumb — its H1 is the title.** A view that
  renders its own `<h1>` is NOT repeated as a breadcrumb segment for itself. The
  dashboards grid's h1 is "Dashboards"; a single dashboard's h1 is its name.
- **A parent index IS a crumb when you're on a child, but not when you're on it.**
  - On the grid (`/website/$channelId`): trail is `#channel` only — no
    "Dashboards" crumb (its own h1 covers it, and `#channel` already links here).
  - On a single dashboard (`/website/$channelId/dashboards/$id`): trail is
    `#channel / Dashboards`, where `Dashboards` links back to the grid. The
    dashboard's name is the h1 below, not a crumb.
- Crumbs reflect navigable parents above the current page; the current page is
  the H1, never a crumb of itself.

## Dashboard naming

- **The dashboard's H1 is its name.** The canvas harness always emits a top-level
  `Heading` (level 1) as the first child of the root `Page`
  (see `CANVAS_SYSTEM_PROMPT` in `genui/catalog.ts`). `dashboardTitleFromSpec`
  (`genui/dashboardTitle.ts`) reads that H1.
- **Editing the H1 renames the dashboard.** On save, the derived title is passed
  as the dashboard `name`; there is no separate name field or rename UI.

## Storage

- Dashboards are **backed by the PostHog desktop file system**, not local files.
  A dashboard is a `dashboard`-typed row nested under its channel folder; its
  name is the last path segment (the H1) and the json-render spec rides in
  `meta.spec`. See `@posthog/core/canvas/dashboardsService.ts`; the `meta` payload
  is typed + documented as `DashboardFileMeta` in `dashboardSchemas.ts`. This
  keeps dashboard and channel names in sync with the backend — the same surface
  that owns channels (top-level `folder` rows, see `hooks/useChannels.ts`).
- `meta.spec` is **last-write-wins, unversioned**. A polling refresh and a
  concurrent edit elsewhere can clobber each other (no `base_version` on `meta`).
  Acceptable for now; revisit with optimistic concurrency / versioning if
  multi-client editing becomes real.

## Channel sidebar preloading

- A channel's contents load **lazily on expand**: `ChannelSection`
  (`components/ChannelsList.tsx`) only passes a real `channelId` to its content
  queries once `open` is true, so the tree doesn't fire one query per channel on
  mount.
- To keep first-open instant, the same caches are **warmed on hover/focus**:
  `ChannelSection.prefetchContents()` runs from the row's `onMouseEnter` /
  `onFocus` and prefetches every per-channel query. Each prefetch hook reuses the
  query's `queryOptions` with the **same `staleTime`** as the live query, so it
  no-ops when the data is already fresh.
- **Rule: lazy-loaded content and preloading must stay in lockstep.** When you
  add a new per-channel item type to the expanded tree (a new query gated on
  `open`, like dashboards or filed tasks), you MUST also:
  1. add a `usePrefetch…` hook next to that query (mirror `usePrefetchDashboards`
     in `hooks/useDashboards.ts` / `usePrefetchChannelTasks` in
     `hooks/useChannelTasks.ts` — same key, same `staleTime`), and
  2. call it inside `ChannelSection.prefetchContents()`.

  Otherwise the new content cold-fetches on first expand and reintroduces the
  open jank the prefetch path exists to prevent.
