# Task: Extract a real `packages/core/src/channels/` feature

Companion to [channels-architecture.md](./channels-architecture.md) — this is
"Where we start" step 1, written as a self-contained brief for the agent
executing it.

## Context

Channels (Bluebird) currently have no home of their own: channel domain logic
lives inside `packages/core/src/canvas/` and channel UI/hooks inside
`packages/ui/src/features/canvas/`. Channel identity is about to be unified
server-side (workstream A). This refactor creates the seam so that later
migration touches one service's internals instead of thirty call sites.

**Pure refactor. No behavior change, no new features, no API/URL changes.**
Everything stays behind the existing `project-bluebird` flag. Read CLAUDE.md
first and follow it exactly (DI rules, no barrel files, import direction,
feature folder shape).

## What moves where

### Phase 1 — new core feature `packages/core/src/channels/`

Create the standard feature shape (see CLAUDE.md "Structure"):

- `identifiers.ts` — standalone token consts
  (`Symbol.for("posthog.channels.<thing>")`).
- `schemas.ts` — move `ChannelTaskRecord` from
  `packages/core/src/canvas/channelTaskSchemas.ts`; add the `Channel` domain
  interface and the `toChannel(fs: Schemas.FileSystem): Channel` mapper,
  moved from `packages/ui/src/features/canvas/hooks/useChannels.ts` (a
  domain mapping does not belong in a UI hook).
- `channelName.ts` + test — move verbatim from
  `packages/core/src/canvas/channelName.ts`.
- `channelTasks.ts` — move `ChannelTasksService` from
  `packages/core/src/canvas/channelTasksService.ts` (interface
  `IChannelTasksService` currently in `canvas/services.ts` moves too).
- `channels.ts` — NEW `ChannelsService` following the `DashboardsService`
  pattern (constructor-injected deps, `@injectable()`). It owns channel CRUD
  that today happens directly in UI hooks against `@posthog/api-client`:
  list channels (`getDesktopFileSystemChannels` → `Channel[]` via
  `toChannel`), create, rename, and folder-instructions (CONTEXT.md)
  read/generation-task plumbing currently reached through
  `useFolderInstructions.ts`. Keep it thin — it wraps existing api-client /
  fs-client calls; do not change endpoints or add logic.
- `channels.module.ts` — `ContainerModule` binding `CHANNELS_SERVICE` and
  `CHANNEL_TASKS_SERVICE`. Load it everywhere `canvasCoreModule` is loaded
  (grep for `canvasCoreModule`; expect desktop renderer contributions +
  apps/web equivalent). Add the new tokens to each composition root's
  `BindingMap`.
- Move `mentionActivity.ts` + test from `canvas/` — it maps `TaskMention`
  DTOs for the channel Activity feed; it is channel-domain, not canvas.

Shared infra decision: `packages/core/src/canvas/desktopFsClient.ts` is used
by both dashboards (canvas) and channel tasks. Move it to
`packages/core/src/product-os/productOsFsClient.ts`, renaming the class to
`ProductOsFsClient` and the token to
`PRODUCT_OS_FS_CLIENT = Symbol.for("posthog.productOs.fsClient")` — "desktop"
must not survive in client-side names (Code ships on web; see the naming
note in channels-architecture.md). Update every reference and every
composition root's BindingMap; the rename is compile-checked. Add a comment
on the class noting it fronts the legacy `desktop_file_system` endpoint,
whose backend rename is tracked separately. While you're at it, rename the
channel-facing api-client methods you touch
(`getDesktopFileSystemChannels` → `getProductOsChannels`, likewise
folder-instructions methods) — mechanical, and call sites are shrinking to
the new core services in this same PR anyway. Do not change any URL path.

Explicitly NOT moving:

- `packages/core/src/links/channel-link.ts` — `links/` is a cohesive
  deep-link feature (task-link, canvas-link, scout-link, ...); leave it, but
  if it imports anything that moved, update the import paths.
- Prompt assembly (`packages/core/src/editor/prompt-builder.ts`,
  `taskCreationSaga.ts` CONTEXT.md folding) — update import paths only.
- `TaskChannel` / `TaskThreadMessage` / `TaskMention` types in
  `packages/shared/src/domain-types.ts` — shared types stay in shared.
- URL paths and OpenAPI-generated types (`Schemas.FileSystem`) — those
  follow the backend rename via the posthog/posthog ADR, not this PR.

### Phase 2 — re-route UI consumers

- `packages/ui/src/features/canvas/hooks/useChannels.ts`,
  `useChannelTasks.ts`, `useTaskChannels.ts`, `useTaskChannelMap.ts`,
  `useFolderInstructions.ts`: keep each hook wrapping exactly one
  query/mutation (CLAUDE.md rule 5), but the query function calls
  `ChannelsService` / `ChannelTasksService` via `useService(...)` instead of
  reaching into `@posthog/api-client` and mapping rows locally. The
  `Channel` type is imported from `@posthog/core/channels/schemas`.
- Update all other import sites of moved files (expect hits in
  `packages/ui/src/features/canvas/components/*` — ChannelsList,
  CreateChannelModal, RenameChannelModal, WebsiteChannelHome,
  WebsiteNewTask, ActivityView — plus `task-detail/`, `tasks/`, router route
  `packages/ui/src/router/routes/website/$channelId/tasks/$taskId.tsx`, and
  host-router if any router forwards these services).
- Do NOT move the channel React components into a new UI feature folder in
  this PR. `packages/ui/src/features/channels/` is a follow-up; note it in
  the PR description.

## Constraints

- Keep query keys, poll intervals, and cache behavior identical (e.g.
  `CHANNELS_QUERY_KEY`, 30s poll in `useChannels`).
- Tokens: standalone `export const` symbols only; no token bags. New symbols
  use `posthog.channels.*`; the fs-client token becomes
  `posthog.productOs.fsClient`. No "desktop" in any new or renamed
  identifier, filename, or folder.
- No barrel files. Deep imports via package public paths as done today.
- Biome `noRestrictedImports` must stay clean:
  `biome lint packages/core` → zero violations.
- Move tests alongside their files; update test imports. Do not rewrite
  tests except paths/DI wiring.

## Verification (run all; report actual output)

1. `pnpm --filter @posthog/core typecheck && pnpm --filter @posthog/ui typecheck`
   then full `pnpm typecheck`.
2. `pnpm --filter @posthog/core test` and `pnpm --filter @posthog/ui test`.
3. `biome lint packages/core packages/ui` — zero `noRestrictedImports`.
4. `rg "canvas/channelTasksService|canvas/channelName|canvas/channelTaskSchemas|canvas/mentionActivity" packages apps`
   → no hits (nothing imports the old paths).
5. `rg "getDesktopFileSystemChannels" packages/ui` → no hits (UI no longer
   calls the API client for channels directly).
6. `rg -i "desktopFs|DESKTOP_FS_CLIENT" packages apps` → no hits;
   `rg "desktop_file_system" packages/core packages/ui` → hits only inside
   `packages/core/src/product-os/` and `packages/api-client` URL strings.
7. Boot check: `pnpm dev` (or apps/web) starts and the channel sidebar +
   a channel's task list render — confirms module registration and
   BindingMap entries are correct in every composition root.

## Acceptance criteria

- `packages/core/src/channels/` exists with service/module/schemas/
  identifiers/tests per the standard feature shape.
- `canvas/` retains only canvas concerns (dashboards, freeform, templates,
  canvas data); zero channel-named files remain in it.
- All channel data access flows through `ChannelsService` /
  `ChannelTasksService`; UI hooks are thin wrappers.
- No behavior change: same endpoints, same query keys, same flag gating.
- Single reviewable PR; commit messages explain what moved and why.
