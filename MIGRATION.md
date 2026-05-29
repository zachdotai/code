# MIGRATION.md — landed slice log

Running log of what moved and where. Ten lines per entry max.

For the procedure to follow when porting a new feature, see [REFACTOR.md](./REFACTOR.md).

---

## 2026-05-28 — file-watcher (workspace-server owns orchestration, hook is pure useSubscription)

- Moved: `apps/code/src/main/services/file-watcher/` deleted entirely. Orchestration (debounce, bulk threshold, git event filtering, git-dir resolution) lives in `packages/workspace-server/src/services/watcher/service.ts` as `WatcherService.watchRepo()`. New tRPC subscription procedure `fileWatcher.watch` emits the processed `FileWatcherEvent` discriminated union. Raw `watcher.watch` still available for unprocessed events.
- **Nothing for file-watcher lives in `packages/core/`.** The "orchestration" we thought belonged in core (debounce, bulk threshold, git filtering) turned out to be *source-smoothing* — properties of the event source, not domain logic. Source-smoothing belongs with the source. Core is for business state machines, retries, cross-feature coordination — none of which file-watcher has.
- New transport (still applies): `workspace-client` uses `splitLink` over `httpSubscriptionLink` (SSE) for subscriptions + `httpBatchLink` for queries/mutations. SSE auth via `?secret=` query param since EventSource can't send headers.
- Renderer hook (`packages/ui/src/features/file-watcher/useFileWatcher.ts`) is a 5-line `useSubscription(trpc.fileWatcher.watch.subscriptionOptions(...))` wrapper. No `useEffect`, no `for-await`, no orchestration state — pure react-query idiom. Caller passes a single `onEvent` callback and switches on `event.kind`.
- Main bridge: `apps/code/src/main/services/file-watcher/bridge.ts` is a small `FileWatcherBridge` class (~40 lines) that subscribes to `fileWatcher.watch` via workspace-client and re-emits via `TypedEventEmitter` for the four legacy in-process consumers (`fs`, `archive`, `suspension`, `workspace`). Bound at `MAIN_TOKENS.FileWatcherService` via `container.bind(...).toConstantValue(new FileWatcherBridge(workspaceClient))` in `index.ts` after `workspaceServer.start()`.
- Bridge retirement: delete `FileWatcherBridge`, its router, and the renderer's `start`/`stop` mutation calls when **fs**, **archive**, **suspension**, **workspace** migrate. Those consumers will then use `useFileWatcher` directly (renderer) or subscribe via workspace-client (background work in workspace-server or main).
- Cleaned: `WatcherRegistryService` dep dropped (its `isShutdown` check is unnecessary — subscriptions die naturally when workspace-server child or main process exits). Schemas split out of `trpc.ts` into per-service `schemas.ts`. Router is now strict one-liners.
- Left as-is: two parallel watcher pipelines per repo (the bridge + the renderer each subscribe to workspace-server); workspace-server doesn't dedupe parcel watchers. `FsService` in main still owns its file-cache invalidation. `WatcherRegistryService` still used by focus + app-lifecycle.
- New import paths: `import { useFileWatcher } from "@posthog/ui/features/file-watcher/useFileWatcher"`. For main consumers needing kind constants: `import { FileWatcherEventKind } from "@posthog/workspace-server/services/watcher/schemas"`. Bridge class: `apps/code/src/main/services/file-watcher/bridge.ts`.

---

## 2026-05-28 — api-client (transport only)

- Moved: `apps/code/src/renderer/api/{fetcher,generated,generated.augment,fetcher.test}.ts` → `packages/api-client/src/`. `generated.augment.d.ts` → `.ts` (side-effect import from `index.ts` so apps/code's tsc picks up the module augmentation through the package's exports).
- Cleaned: `__APP_VERSION__` Vite global removed from fetcher — now an `appVersion` field on `ApiFetcherConfig`. Renderer wrapper passes the global at construction.
- Left as-is: the 2929-line `posthogClient.ts` god-class. Tagged with a `PORT NOTE` — gets sliced into `packages/core/<feature>/service.ts` per feature, following REFACTOR.md "Coexistence and bridges".
- New import path: `@posthog/api-client` (was `@renderer/api/{fetcher,generated}`). Also updated `scripts/update-openapi-client.ts` to write into the new package.

---

## 2026-05-28 — focus (core owns orchestration, workspace-server owns host/git work)

- Moved host operations out of Electron main: `apps/code/src/main/services/focus/sync-service.ts` deleted; git/worktree/watch logic now lives in `packages/workspace-server/src/services/focus/{service,sync-service}.ts` behind one-line `focus.*` procedures in `packages/workspace-server/src/trpc.ts`.
- Moved orchestration out of the renderer: `apps/code/src/renderer/stores/sagas/focusSagas.ts` deleted; multi-step enable/disable/restore flow now lives in `packages/core/src/focus/service.ts` as `FocusController`, with dependencies injected as a pure interface.
- Renderer stays thin: `apps/code/src/renderer/stores/focusStore.ts` is now UI state plus one controller call per action. It adapts existing tRPC calls into the core dependency interface and no longer owns the flow graph.
- Main is a bridge, not the source of truth for focus logic: `apps/code/src/main/services/focus/service.ts` now persists the local session snapshot for Electron restarts, forwards mutations/queries to workspace-server through `WorkspaceClient`, and re-emits focus events to legacy main-router subscribers.
- Bridge retirement: delete the main `FocusService` shim and move persisted focus-session storage out of Electron once session restore/event subscribers can read directly from workspace-server (or the eventual shared persistence layer). At that point the main `focus` router can disappear with the bridge.
- Left as-is: restore still re-saves the validated session before starting workspace-server watchers so the server-side in-memory session map is repopulated after app restart. That is intentional coexistence glue, not the final architecture.

---

## 2026-05-27 — diff-stats

- Moved: `apps/code/src/main/services/git/getDiffStats` → `packages/workspace-server/src/services/git/service.ts` + `packages/ui/src/features/diff-stats/`
- New: `@posthog/workspace-server`, `@posthog/workspace-client`, `@posthog/ui` packages. Workspace-server runs as a child process spawned by Electron (`ELECTRON_RUN_AS_NODE=1`).
- Cleaned: PSK comparison now uses `timingSafeEqual`. `DiffStats` schema is the source of truth (`z.infer`), not the type. Connection query invalidates on child exit via a tRPC subscription.
- Left as-is: `useTaskDiffSummaryStats` still has 4 modes (local/branch/PR/cloud). Collapses once the relay protocol exists.
- New import paths: `useDiffStats(repoPath)` from `@posthog/ui/features/diff-stats/useDiffStats` (was `trpc.git.getDiffStats`). `DiffStatsBadge` from `@posthog/ui/features/diff-stats/DiffStatsBadge`.
