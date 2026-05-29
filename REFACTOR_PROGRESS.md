# REFACTOR_PROGRESS.md — append-only agent log

Tactical, append-only record of what each agent session changed, validated,
deferred, or broke during the `apps/code` -> packages migration.

- Newest entries at the bottom.
- One entry per session, even short ones.
- Format below. Keep entries short and operational.
- Source of truth for slice status is [REFACTOR_SLICES.json](./REFACTOR_SLICES.json).
- Landed architectural movement is summarized in [MIGRATION.md](./MIGRATION.md).
- The procedure is in [REFACTOR.md](./REFACTOR.md); the layering rules are in [AGENTS.md](./AGENTS.md).

## Entry format

```md
## YYYY-MM-DD HH:MM — <agent/session id> — <slice id>

- Changed: `<paths>`
- Validated: `<commands and smoke test actually run>`
- Slice status: `<todo|in_progress|blocked|needs_validation|passing>`
- Next: `<specific follow-up or next slice>`
```

---

## 2026-05-29 — initializer — harness setup (no slice claimed)

- Changed: created `REFACTOR_SLICES.json`, `REFACTOR_PROGRESS.md`, `scripts/refactor-init.sh`.
- Audit: enumerated 57 slices from `apps/code` (43 main services, 39 tRPC routers, 52 renderer features, 15 platform interfaces). 4 slices recorded as already `passing` from prior landed work (`diff-stats`, `file-watcher`, `focus`, `api-client` — see MIGRATION.md); the remaining 53 are `todo`.
- Key audit findings recorded as the highest-priority slices:
  - **Foundation is not built yet.** `packages/di` is empty (no package.json/src). No `useService`, `WORKBENCH_CONTRIBUTION`, `WorkbenchContribution`, `startWorkbench`, or `ContainerModule` exist in source. → slice `di-foundation` (priority 100), REFACTOR.md Recommended Order step 1. Most other slices depend on it.
  - **Platform interfaces lack Symbol identifiers.** `packages/platform/src/*.ts` define interfaces only; they are bound today via legacy `MAIN_TOKENS` in `apps/code/src/main/di/tokens.ts`. → slice `platform-identifiers` (priority 90).
  - Forbidden patterns confirmed present and tagged on their slices: `os.ts` is a 401-line router with no backing service (`dialog-capability`, `misc-host-capabilities`); `WorkspaceService` uses `container.get(FileWatcherService)` and a router-bypasses-service-to-repository pattern (`workspace`); `TaskService` is a renderer DI service that fetches domain data (`ui-task-detail`); the ~3796-line renderer sessions service (`sessions`).
  - `FileWatcherBridge` retirement is gated on four consumers: `fs-capability`, `archive`, `suspension`, `workspace`.
- Validated: `node -e` JSON parse of `REFACTOR_SLICES.json` (57 slices, no duplicate ids, all required fields present); `bash -n scripts/refactor-init.sh`. No application code changed, so no app smoke test was run.
- Slice status: n/a (no slice claimed; this was the initializer pass, REFACTOR.md Recommended Order step 0).
- Next: an agent should claim `di-foundation` (priority 100) and establish the shared DI primitives before broad parallel feature work begins. `connectivity` (82) and `projects` (81) are good first read-only feature slices to exercise the foundation once it lands.

## 2026-05-29 — initializer — coverage gap closure (no slice claimed)

- Triggered by review: first audit covered services/routers/features/stores/platform but missed (a) non-feature main surface and (b) the entire shared React surface.
- Added slices: `analytics`, `ui-event-bus` (UIService, uses container.get in router), `ui-app-shell` (themeStore + rendererWindowFocusStore); folded the host-only `workspace-server` child-process service into `app-lifecycle`.
- After REFACTOR.md gained the "Porting React UI" section, added the shared-React slices: `ui-primitives` (packages/ui/src/primitives — components/ui, shared visuals, action-selector, generic hooks), `ui-shell` (App.tsx/main.tsx/Providers/layout/styles + boot dismantled into contributions), `ui-permissions` (components/permissions, ACP-typed), `renderer-shared-hooks` (feature-coupled hooks in renderer/hooks redistributed to owning features), `renderer-shared-utils` (utils/types/assets split: host-agnostic->ui/shared, host-coupled->platform).
- Folded domain cross-cutting into owners (no double-ownership): sagas/task -> `ui-task-detail`, constants/keyboard-shortcuts -> `ui-command`, utils/analytics.* -> `analytics`.
- Coverage: wrote a scan over all 281 code items under apps/code/src + packages/platform/src. 281 mapped except 3 intentional non-slices, now recorded in REFACTOR_SLICES.json meta.deliberatelyNotSliced (main services/index.ts, main services/types.ts, renderer hooks/useFileWatcher.ts).
- Validated: JSON parses, 65 slices (61 todo, 4 passing), no duplicate ids, all required fields present.
- Slice status: n/a (initializer). Next unchanged: claim `di-foundation`. Note `ui-primitives` (priority 83) should land early because feature UI ports may not import apps/code, so they need primitives in @posthog/ui first.
