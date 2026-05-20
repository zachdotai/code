# Stage 5 Plan — Physical split into `packages/hedgemony-core`

The goal: move framework-free hedgemony code into its own pnpm workspace package so the orchestrator concept can be consumed by a non-Electron, non-React UI (terminal renderer, server-side simulator, etc.) without copying files.

Stages 0–4 already drew the *logical* boundary — what's portable vs what's renderer-specific. Stage 5 makes that boundary *physical*. There's no behavioral change. It's pure file movement plus import rewriting.

## What moves vs what stays

| Lives in `packages/hedgemony-core/src/` | Stays in `apps/code/src/renderer/features/hedgemony/` |
|---|---|
| `domain/` (9 interfaces: `HogletRepository`, `HogletPositionRepository`, `NestRepository`, `NestChatRepository`, `PrGraphRepository`, `HogletRemoteService`, `NestRemoteService`, `PrGraphRemoteService`, `ToastSink`) | `adapters/` (9 Zustand + tRPC adapter implementations — they depend on stores and `trpcClient`) |
| `state/BuilderStateMachine.ts` + tests | `stores/` (Zustand) |
| `state/HedgemonyController.ts` + tests (pure transition functions) | `service/` (mutations — they take interfaces as deps but the *default* dep instances bind to adapters, so the wiring stays here) |
| `state/computeMapClickAction.ts` + tests | `hooks/` (all React hooks: `useHogletVisuals`, `useHedgemonyHotkeys`, `useHedgemonySubscriptions`, `useCameraBookmarks`, `useHedgemonyFullscreen`, `useHedgemonyMapInput`, `useHedgemonyCommands`, `useHedgemonyDerivedState`, `useHedgemonyEscapeKey`, `useHedgemonySelectionSync`, `useMoveMarker`, `useBuilderCoordinator`, `useTransitPath`, `useWalkTo`, `useSignalIngestion`, `useHedgemonyPromptRouter`, `useHedgemonyPrGraphRouter`) |
| `runtime/SceneTicker.ts` + `FakeSceneTicker.ts` + tests | `components/` (all .tsx) |
| `geometry/` (renamed from `utils/`): `pathfinding`, `coordinates`, `hogletPositions`, `worldObstacles`, `collisionResolution` (pure math part), `nestColors` | `audio/` (HTML5 audio) |
| `util/`: `signalPrompt`, `selectHogletAnimation`, `nestLifecycle`, `hogletVisualPositions` (if pure) | `devtools/` (developer tools) |
| `config.ts` (tuning constants) | `constants/` (buckets, hotkeys, map — some of these reference React stuff and may stay) |

**Total files moving**: ~28 source + ~12 test files. Some `utils/` files (e.g. `usePanCamera.ts` — a React hook) stay despite being in `utils/`; check each.

## Import sites that need rewriting

Measured by `grep -rln <symbol>` against `apps/code/src/`:

| Symbol/area | Importer count |
|---|---|
| Domain interfaces (combined) | 24 files |
| `HedgemonyController` | 6 |
| `computeMapClickAction` | 6 |
| `SceneTicker` / `sceneTicker` | 5 |
| `BuilderStateMachine` | 2 |
| Geometry/utils (pathfinding, coordinates, etc.) | not measured — likely 20–30 across components/hooks |

**Estimated rewrite surface**: ~50–80 import statements across ~40 files. Largely mechanical — a find/replace from `../state/...` / `../utils/...` etc. to `@posthog/hedgemony-core` or relative cross-package paths.

## Substages

Each substage is a single commit. Each substage gates on `pnpm --filter code typecheck` green + `pnpm --filter code test src/renderer/features/hedgemony src/main/services/hedgemony` green.

### 5a — Skeleton package (no files moved)

- Create `packages/hedgemony-core/` with:
  - `package.json` (`@posthog/hedgemony-core`, `type: module`, exports `./src/index.ts`... actually no — `CLAUDE.md` forbids barrel files. Per-file exports instead. Need to decide: package `exports` map with specific subpaths (e.g. `./domain/HogletRepository`, `./state/BuilderStateMachine`)? Or direct path imports (`@posthog/hedgemony-core/src/state/BuilderStateMachine`)? Pick one before 5b.
  - `tsconfig.json` extending root, NOT producing JS (project references with `composite: true` for type emission only).
  - `vitest.config.ts` for the package's own tests.
- Add `@posthog/hedgemony-core: workspace:*` to `apps/code/package.json` dependencies.
- Add to root `tsconfig.json` paths + `turbo.json` if needed.
- `pnpm install`. Verify `apps/code` still builds and tests still pass — there should be ZERO behavioral change since no files moved yet.

Commit: `refactor(hedgemony): scaffold packages/hedgemony-core workspace package`

### 5b — Move `geometry/` (pure math)

Smallest, lowest-risk, fewest cross-references. Files (with their `.test.ts` siblings):
- `pathfinding.ts`, `coordinates.ts`, `hogletPositions.ts`, `worldObstacles.ts`, `collisionResolution.ts`, `nestColors.ts`

Use `git mv` to preserve history. Rewrite imports across `apps/code/src/`. Run typecheck + tests.

Commit: `refactor(hedgemony): move geometry utils to hedgemony-core`

### 5c — Move `config.ts`

Single file, but referenced from many places. Quick.

Commit: `refactor(hedgemony): move config to hedgemony-core`

### 5d — Move `runtime/` (SceneTicker + FakeSceneTicker)

5 importers to rewrite.

Commit: `refactor(hedgemony): move SceneTicker runtime to hedgemony-core`

### 5e — Move `state/` (state machines + pure reducers)

`BuilderStateMachine`, `HedgemonyController`, `computeMapClickAction`. ~14 importers combined. These depend on geometry (already moved in 5b), so intra-package imports work cleanly.

Commit: `refactor(hedgemony): move state machines and reducers to hedgemony-core`

### 5f — Move `domain/` interfaces (BIGGEST RISK)

9 interfaces, 24 importers. Importers are mostly in `adapters/` (stay in app) and `service/` (stays in app). Rewriting touches the adapter implementations that *implement* these interfaces, plus the mutation functions that *consume* them.

The interfaces use TypeScript-only shapes (no runtime), so as long as imports resolve, no behavior changes.

Commit: `refactor(hedgemony): move domain interfaces to hedgemony-core`

### 5g — Move pure utilities

`signalPrompt`, `selectHogletAnimation`, `nestLifecycle`, possibly `hogletVisualPositions` (verify pure). Skip anything that touches React refs/DOM/zustand.

Commit: `refactor(hedgemony): move pure utilities to hedgemony-core`

### 5h — (Optional) Move framework-free service mutations

`moveNest`, `adoptHoglet`, `releaseHoglet`, `handleHogletDrop` take repository + remote-service interfaces as deps. They're framework-free now. They COULD live in core.

But: the `default*Deps` singletons that auto-wire Zustand + tRPC must stay in apps/code (they import concrete adapters). So mutations would split: pure functions in core, default-deps singletons in app.

**Recommendation: SKIP 5h for v1.** Keep service mutations in apps/code; revisit if and when a second consumer actually exists.

### 5i — Final verification

- Full `pnpm --filter code test` green.
- `pnpm build` at root (turbo) green.
- `grep -rn "from \"@features/hedgemony/\(domain\|state\|runtime\|geometry\|util\)/" apps/code/src/` returns nothing — all such imports now go through `@posthog/hedgemony-core`.
- HedgemonyMapView LOC unchanged from end-of-Stage-4 (~404). Stage 5 doesn't change line counts; it changes file locations.

No commit needed — verification only.

## Risks

1. **Module resolution surprises.** pnpm workspaces + TypeScript `paths` + Vite + Vitest + Turbo all have to agree. Most likely failure: tests in `apps/code` can't find symbols in `packages/hedgemony-core` because vitest is configured with renderer-relative aliases. Mitigation: 5a explicitly tests this with an unused symbol *before* moving real files.

2. **Circular references between packages.** If anything in `hedgemony-core` ends up importing `@features/hedgemony/...` (back into apps/code), the build breaks. The audit at end of Stage 4 says nothing in `domain/`, `state/`, `runtime/`, or pure utils imports from React/Electron/Zustand/tRPC — but verify per file before moving. Mitigation: each substage greps the moving file for forbidden imports BEFORE the move.

3. **Test discovery.** Tests living in `packages/hedgemony-core/src/**/*.test.ts` need their own vitest config. Cleanest: each package gets its own `vitest.config.ts`; root `pnpm test` is a turbo task that runs both. Most existing test infrastructure (test helpers, mocks) is in `apps/code/src/test/` — if `packages/hedgemony-core` tests need any of it, that infra has to move too (or get its own copy).

4. **Adapters' tight coupling to renderer infra.** Adapters like `zustandHogletRepository.ts` import from `apps/code/src/renderer/features/hedgemony/stores/...`. After move, they need to import the *interfaces* from `@posthog/hedgemony-core` while keeping their Zustand store imports in-app. Each adapter is a 2-line import edit.

5. **Pre-commit hook drift.** lint-staged + Biome run on staged files. Moving files across packages might trigger Biome `--unsafe` over each one (same bug class that hung earlier). Mitigation: do the move-and-import-rewrite in one atomic commit per substage; if a substage's Biome run hangs, kill it and retry with `--no-verify` on that single substage commit (with your explicit OK).

6. **Other agents pushing while Stage 5 runs.** Stage 5 touches many files; another developer rebasing on top of an in-progress Stage 5 could hit massive conflicts. Mitigation: same pull-rebase-before-every-commit discipline as Stages 0–4. The biggest substages (5b, 5e, 5f) might warrant pulling immediately *before* opening their editor.

## Test impact

- All existing tests should pass unchanged after Stage 5. Tests for files that move come with them.
- Coverage at end of Stage 4: 455 hedgemony tests + ~1213 elsewhere = 1668 total. Stage 5 doesn't add or remove tests.
- **One real new tax**: a test in `packages/hedgemony-core` cannot import test utilities from `apps/code/src/test/`. If any moving test relies on that infra (most don't — they're pure-logic tests), it has to be paired with a small test-utils file in `packages/hedgemony-core`.

## What I will NOT touch in Stage 5

- React components, hooks, audio, stores, adapters, service mutations — all stay in `apps/code`.
- Behavior of any of the moved files.
- The `apps/code` build pipeline beyond what's required to depend on the new package.
- Anything outside `apps/code/src/renderer/features/hedgemony/` and the new `packages/hedgemony-core/`.

## Effort signal

Relative to Stages 0–4:
- 5a (scaffold): smaller than any other substage so far.
- 5b–5g (file moves): roughly the size of Stage 3, but spread across more commits.
- 5h (mutation move): skipped per recommendation.

If a single hung pre-commit hook costs minutes to recover from (as it did during Stage 4), expect 1–2 of those across Stage 5 given the higher file-touch count.

## Recommendation

**Do Stage 5 only if there's a concrete consumer in the next ~quarter.** Reasoning:

- The *logical* boundary already exists. Anyone wanting to extract the orchestrator can read the file list above and grab those files manually. Physical extraction's main benefit is forcing the boundary to stay clean over time, which only matters if you have a second consumer pulling on it.
- The physical move itself adds friction (cross-package imports, two test runners, additional tsconfig orchestration) for as long as there's only one consumer.
- Conversely: if you DO have a near-term plan to drive hedgemony from a different UI (CLI, server simulator, second Electron product), do Stage 5 *now* before the boundary erodes — adding a new consumer against the current logical-only boundary will tempt people to violate it.

**My take, stated plainly:** I'd skip Stage 5 for now. Stages 0–4 made the orchestrator extraction *possible*; Stage 5 is the cost paid only when extraction is *actually happening*. The status doc + this plan are enough to document the boundary so a future-you can pick it up in an afternoon.

If you decide to do it anyway, the plan above is concrete enough to launch an agent against — substage-by-substage with the same pull-rebase discipline as Stages 0–4.

## Open questions for you

1. Is there an actual planned consumer of hedgemony-core in the near term? If yes, what's its shape (browser, Node, terminal, etc.)? That determines whether the package needs to be ESM-only, CJS-compatible, browser-bundled, etc.
2. Are you OK with `@posthog/hedgemony-core` exposing per-file subpath imports (e.g. `@posthog/hedgemony-core/state/BuilderStateMachine`) instead of a barrel? CLAUDE.md forbids barrels.
3. Do you want the package tested independently (own vitest config) or piggybacked on `apps/code`'s test runner? Independent is cleaner; piggyback is faster to set up.
