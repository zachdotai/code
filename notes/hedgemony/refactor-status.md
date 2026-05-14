# Hedgemony Modularity Refactor — Status

Snapshot of where the staged refactor (per [modularity-review.md](./modularity-review.md)) sits right now.

## Done

Stages 0–3 of the 5-stage roadmap are complete. All commits on `hedgemony` (local), 5 commits ahead of `origin/hedgemony`. Not pushed.

### Stage 0 — Foundations (5 commits)
- `refactor(hedgemony): centralize tuning constants in config.ts` — new `apps/code/src/renderer/features/hedgemony/config.ts`
- `refactor(hedgemony): extract selectHogletAnimation as a pure function` — new `utils/selectHogletAnimation.ts` + `.test.ts` (30 cases)
- `refactor(hedgemony): extract useHogletVisuals hook` — new `hooks/useHogletVisuals.ts`
- `refactor(hedgemony): collapse WildHoglet and BroodHoglet onto useHogletVisuals`
- `refactor(hedgemony): extract computeMapClickAction pure reducer` — new `state/computeMapClickAction.ts` + `.test.ts` (7 cases)

### Stage 1 — Invert data dependency in mutations (7 commits)
- `refactor(hedgemony): define repository and remote service interfaces` — new `domain/` directory with `HogletRepository.ts`, `HogletPositionRepository.ts`, `NestRepository.ts`, `NestChatRepository.ts`, `PrGraphRepository.ts`, `HogletRemoteService.ts`, `NestRemoteService.ts`, `PrGraphRemoteService.ts`, `ToastSink.ts`
- `refactor(hedgemony): implement Zustand and tRPC adapters for hedgemony interfaces` — new `adapters/` directory with Zustand-backed repository adapters and tRPC-backed remote-service adapters
- `refactor(hedgemony): inject dependencies into moveNest with rollback tests` — `moveNest` + 4 tests
- `refactor(hedgemony): inject dependencies into adoptHoglet with rollback tests`
- `refactor(hedgemony): inject dependencies into releaseHoglet with rollback tests`
- `refactor(hedgemony): inject dependencies into handleHogletDrop`
- `refactor(hedgemony): inject dependencies into subscription initializers`

### Stage 2 — Extract BuilderStateMachine (3 commits)
- `refactor(hedgemony): extract BuilderStateMachine class with unit tests` — new `state/BuilderStateMachine.ts` + 22 tests; framework-free
- `refactor(hedgemony): rewire useBuilderCoordinator as adapter over BuilderStateMachine` — hook collapsed 258 → ~180 LOC
- `refactor(hedgemony): make builder position dependency explicit` — removed shared `positionRef`, `BuilderSprite` now exposes `getCurrentPosition()` via `forwardRef`/imperative handle

### Stage 3 — Centralize SceneTicker (5 commits)
- `refactor(hedgemony): add SceneTicker and FakeSceneTicker with unit tests` — new `runtime/SceneTicker.ts`, `runtime/FakeSceneTicker.ts` + 18 tests
- `refactor(hedgemony): migrate AnimatedHedgehog to SceneTicker`
- `refactor(hedgemony): migrate collision resolver to SceneTicker`
- `refactor(hedgemony): drive useWalkTo from SceneTicker` — replaced framer's `animate()` with manual interpolation; `FakeSceneTicker` can now drive walks deterministically
- `refactor(hedgemony): migrate usePanCamera to SceneTicker` — preserved the "idle = no work" gating from the earlier perf commit

After Stage 3: `grep -rn requestAnimationFrame apps/code/src/renderer/features/hedgemony/` only matches `runtime/SceneTicker.ts` (implementation) and one out-of-scope single-frame DOM-scroll fix in `NestDetailPanel.tsx`.

### Test counts at each stage (hedgemony renderer only)
- Baseline: 116
- End of Stage 0: 153 (+37)
- End of Stage 1: 169 (+16)
- End of Stage 2: ~187
- End of Stage 3: 209 (+22)

## Outstanding work

### Stage 4 — Split HedgemonyMapView controller from view (NOT STARTED)
Per the roadmap, the next stage is to extract `HedgemonyController` plus `useHedgemonyHotkeys`, `useHedgemonySubscriptions`, `useCameraBookmarks`, `useControlGroupHotkeys` hooks, slimming `HedgemonyMapView.tsx` from ~1000 LOC to ~250 LOC of pure rendering + thin hook adapters.

### Stage 5 — Physical split into packages (optional, NOT STARTED)
Move the framework-free pieces (domain interfaces, BuilderStateMachine, SceneTicker, computeMapClickAction, geometry utils) into a `packages/hedgemony-core` package. React adapters stay under `apps/code`. This is the "make it extractable for a different UI" capstone.

## Current operational state (the part to clean up first)

`git status` right now:
- On `hedgemony`, 5 commits ahead of `origin/hedgemony` (Stage 3's commits).
- **Two files staged-but-not-committed**: `HedgemonyMapView.tsx` and `useBuilderCoordinator.ts`. The diff is essentially a revert of origin's `33b3fbbd feat: money hog` plus a `PlaceNestDialog` positioning tweak. **Confirmed not user-authored** (user said so explicitly). Almost certainly stale editor-buffer content that was written back over the rebased HEAD by some IDE save event. **These should be discarded** — `git restore --staged --worktree <files>` resets them to HEAD's version.

If `git restore` doesn't fully clean the index (it didn't in my last attempt — index stayed staged), check that no other staged content snuck in.

## Known issues, separate from the refactor

1. **`hedgehog-tick-service.test.ts`** — `ENOENT: no such file or directory, mkdir '/mock/userData'`. Pre-existing electron-store test-init issue. Flagged by every Stage 0–3 agent as not theirs. Independent fix needed.

2. **`operator-decision-repository.test.ts`** (7 tests) — was failing with `NODE_MODULE_VERSION` mismatch on `better-sqlite3`. Fixed once with `pnpm rebuild better-sqlite3`. Then a later run had `testDb.close is not a function`. State unclear at session end — `pnpm rebuild better-sqlite3` should be the first thing to try if it recurs.

3. **Pre-commit hook hung** on a recent commit attempt. `lint-staged` invoked `biome check --write --unsafe` on `HedgemonyMapView.tsx` + `useBuilderCoordinator.ts` and ran for 13+ minutes before I killed it. Cause unclear — possibly Biome's `--unsafe` mode looping on something in those files. If you hit this again, kill the `biome` process and either (a) use `--no-verify` on a one-off checkpoint commit (with your explicit OK), or (b) run `biome check` on those files manually without `--unsafe` to see what it actually wants.

4. **Origin can drift mid-stage.** During Stages 2 and 3, origin advanced multiple times. I now have a feedback memory ([feedback_pull_during_refactors.md](file:///Users/mattbrooker/.claude/projects/-Users-mattbrooker-dev-posthog-code/memory/feedback_pull_during_refactors.md)) instructing me to fetch and check divergence at every stage boundary, not reactively.

5. **The "WIP files" confusion** that consumed time in this session was: I assumed two files showing as modified were user WIP, when actually no human was writing them. The likely culprit is the IDE saving stale buffers back to disk during rebases. Defensive move when reconciling: don't restore-from-backup unless you've confirmed the diff is actually intended new work, not regression of just-pulled content.

## Recommended next steps

1. **Clean the tree**: `git restore --staged --worktree apps/code/src/renderer/features/hedgemony/components/HedgemonyMapView.tsx apps/code/src/renderer/features/hedgemony/hooks/useBuilderCoordinator.ts`. Confirm `git status` is empty. Confirm `pnpm --filter code test` is green (rebuild `better-sqlite3` if the operator-decision-repository tests fail again).
2. **Decide on push**: Local is 5 commits ahead of origin. Pushing is fast-forward (no force). Once pushed, the refactor work is durable and any future "WIP" confusion can't corrupt it.
3. **Decide on Stage 4**: Whether to continue, defer, or call the refactor done at Stage 3. Stage 4 is mechanically the largest single change (touches `HedgemonyMapView.tsx` heavily) and not strictly required for the orchestrator-extraction goal — Stage 3's SceneTicker is what unblocks headless simulation.
4. **Stage 5 (package extraction)** only makes sense if someone actually wants to drive hedgemony from a non-Electron UI. Worth re-evaluating after Stage 4 (or after deciding to skip Stage 4).
