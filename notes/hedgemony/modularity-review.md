# Hedgemony — Modularity & Portability Review

A code-quality review of the hedgemony feature with one specific lens: **how much work is it to extract the orchestrator concept and drive it from a different UI** (terminal renderer, headless CLI, server-side simulator, a different map renderer)?

This is not a generic "clean it up" doc. It's an extraction-readiness doc.

---

## TL;DR

Hedgemony has **excellent product design**, **solid component composition**, and a **well-tested geometry/algorithm core**. The problem is that domain logic, orchestration, and React rendering are fused at the level of every store read and every animation tick. The map view itself is also a 900-line god component.

**To make hedgemony portable in any meaningful sense, three things have to be true:**

1. The "orchestrator" — builder state machine, mutations, signal ingestion, selection model — must not know about React, Zustand, framer-motion, tRPC, or `@dnd-kit`.
2. The simulation loop (collision tick, sprite frames, walk animation) must run from one central ticker, not one rAF per component, so it can be paused, replayed, or driven from outside React.
3. State access in mutations and orchestration must go through narrow injected interfaces (`HogletRepository`, `NestRepository`, `RemoteService`), so Zustand becomes one of N implementations.

The good news: the public surface is tiny (`HedgemonyMapView` + the tRPC router + a feature flag), the geometry layer is already clean and tested, and the worst sins are concentrated in five or six files. This is refactorable, not rewritable.

---

## Scope of the review

- Reviewed: 73 source files under `apps/code/src/renderer/features/hedgemony/`, 20 main-process services under `apps/code/src/main/services/hedgemony/` and related handlers, the tRPC router at `apps/code/src/main/trpc/routers/hedgemony.ts`, and 22 test files (2342 LOC of tests).
- Product intent: see `notes/hedgemony/user-stories.md` — RTS-style command center for AI agent orchestration; nests group goals, hedgehogs conduct, hoglets execute, signals auto-route, PRs stack and rebase, completion is judged by an LLM.
- The map view is the only inbound entry point from the rest of the app; everything else is internal.

---

## What is "the orchestrator" we want to extract?

The product concept that has value independent of this specific UI is:

- **Domain model**: `Nest`, `Hoglet`, `HedgehogState`, `PrDependency`, `SignalReport`, `Selection`, `ControlGroup`.
- **State transitions**: adopt/release a hoglet, move a nest, place a nest, switch view mode, recall control groups, dispatch goal/spec drafts, route signal → nest.
- **Simulation**: builder state machine (idle/walking/building), pathfinding, collision resolution, walk timing, control-group selection logic.
- **Coordination**: signal ingestion, feedback routing, PR-graph rebase, hedgehog tick — already lives in main-process services and is in the right shape; just needs cleaner seams.

The map renderer, sprites, dialogs, hotkeys, drag-drop kit, framer-motion animations, and Zustand wiring are **adapters**. None of them are the orchestrator.

Today, that line is invisible. Everything above sits inside React hooks, Zustand stores, and components.

---

## What's already portable (do not regress)

These are the parts that pass a clean-architecture sniff test today. They should be the seed of any extracted package.

- **Pure geometry & algorithms**, all well-tested:
  - `utils/pathfinding.ts` — A* with snap helpers
  - `utils/collisionResolution.ts` (pure tick math, *not* the hook in the same area)
  - `utils/hogletPositions.ts` — orbit and ring math
  - `utils/coordinates.ts` — world/screen transforms
  - `utils/worldObstacles.ts` — obstacle assembly
  - `utils/nestColors.ts` — color assignment
  - `utils/signalPrompt.ts` — prompt builder from signal data
- **Pure reducers**, testable in isolation:
  - `components/placeNestDialogReducer.ts` (265 LOC of tests)
- **Zustand selector functions** (`selectHogletById`, `selectNestHoglets`, etc.) — pure, composable.
- **Domain-shaped main-process services** — `NestService`, `HogletService`, `HedgehogTickService`, `FeedbackRoutingService`, `PrGraphService` are `@injectable()`, stateless across requests, and persist state to SQLite, not RAM. Architecture compliance here is good.
- **Discriminated unions** — `ViewMode`, `Selection`, `BuilderState`. Make state transitions exhaustive.
- **Service-layer mutation pattern** — `moveNest`, `adoptHoglet`, `releaseHoglet`, `handleHogletDrop` already use optimistic-update + rollback, which is the right shape for a portable orchestrator. They just need the Zustand dependency inverted (see below).
- **Tiny public surface**: only `HedgemonyMapView` and the tRPC router are imported from outside hedgemony. There are no leaky exports.

These should keep their shape under refactoring. If a refactor breaks any of them, the refactor is wrong.

---

## The five structural problems blocking portability

### 1. Domain logic depends on React, Zustand, framer-motion, tRPC, and `@dnd-kit` — directly

The dependency direction is inverted everywhere. A few representative examples:

- `service/nestMutations.ts:37–60` calls `useNestStore.getState().upsert(...)` and `trpcClient.hedgemony.nests.update.mutate(...)` inside the same function. Mutations are bound to both the renderer state library and the IPC transport.
- `service/hogletMutations.ts:36–56` reads `useHogletStore.getState().byBucket[...]` to build optimistic updates.
- `hooks/useBuilderCoordinator.tsx:87–149` *is* the builder state machine — it lives inside `useState` / `useRef` / `setTimeout` inside a React hook.
- `hooks/useSignalIngestion.tsx:54–170` is the signal ingestion pipeline — it lives inside `useEffect`, calls `useInboxReports` directly, and writes to stores and tRPC inside the effect body.
- `utils/collisionResolution.ts` (the hook, not the math) exposes framer-motion `MotionValue<number>` as part of its interface. The physics tick can't run without `MotionValue`.

**What "correct" looks like:** the orchestration layer depends on narrow interfaces it owns.

```ts
// domain/HogletRepository.ts
export interface HogletRepository {
  get(id: string): Hoglet | null;
  inBucket(bucket: string): Hoglet[];
  upsert(bucket: string, hoglet: Hoglet): void;
  remove(bucket: string, id: string): void;
}

// domain/NestRemoteService.ts
export interface NestRemoteService {
  update(input: NestUpdateInput): Promise<Nest>;
  watch(): AsyncIterable<NestEvent>;
}

// service/moveNest.ts (orchestration, framework-agnostic)
export async function moveNest(
  nest: Nest, mapX: number, mapY: number,
  deps: { nests: NestRepository; remote: NestRemoteService; toast?: ToastSink }
): Promise<void> { /* ... */ }
```

Zustand + tRPC + Sonner become *one* set of adapters. A test, a CLI, or a server can pass different ones.

### 2. `HedgemonyMapView` is a 900-line god component

`components/HedgemonyMapView.tsx:90–912` does layout, gesture dispatch, hotkey setup (45+ bindings on lines 317–591), selection model, mode transitions, subscription lifecycle, fullscreen state, audio control, builder coordination, signal ingestion, and PR-graph init.

This is the orchestrator — but it's inside a React component, so none of it is extractable. Twenty-plus `useEffect`s on a single component is also a maintainability red flag in its own right (the Kent C. Dodds "if you have many effects in one component, you have many concerns in one component" smell).

Split it as:

- `HedgemonyController` — plain class or pure functions over a state machine; owns mode transitions, selection logic, control-group recall, the map-click reducer.
- `useHedgemonyHotkeys`, `useHedgemonySubscriptions`, `useCameraBookmarks`, `useControlGroupHotkeys` — thin React adapters that delegate to the controller.
- `HedgemonyMapView` — pure render, props-driven.

The map-click logic in particular is a textbook candidate for Replace Method with Method Object:

```ts
// Pure, testable, framework-free
export function computeMapClickAction(input: {
  mode: ViewMode; click: Vec2; nests: Nest[]; builder: BuilderState;
}): { nextMode: ViewMode; nestMutation?: NestPatch; builderWalk?: Vec2 } { /* ... */ }
```

This is the single highest-leverage refactor in the whole feature.

### 3. Every animation drives itself from inside its own component, via its own rAF loop

- `components/AnimatedHedgehog.tsx:102–135` — one rAF per sprite for frame advancement.
- `utils/collisionResolution.ts:100–104` (hook) — global rAF lazily started by mounting hooks.
- `hooks/useWalkTo.ts` — `animate(motionY, ...)` per walking entity.
- `components/usePanCamera.ts` — separate rAF for camera pan.

This is the most pervasive coupling in the codebase. Consequences:

- You can't pause the scene.
- You can't deterministically replay it.
- You can't run physics in a Web Worker, in a CLI, or on the server.
- Mid-tick unmount leaves dangling rAF handles and stale closures.
- Render cycles drive simulation (`useTransitPath` re-runs when motion values change, which re-runs pathfinding, which feeds back into motion).

There should be **one** `SceneTicker` that emits `tick(deltaMs, frameCount)` events. AnimatedHedgehog subscribes for frame advancement, the collision resolver subscribes for physics, the walker subscribes for position interpolation. The ticker can be stopped, stepped, or replaced with a fake clock in tests. Framer-motion's `MotionValue` becomes an *output* transport, not the simulation substrate.

This is also the gate for ever running collision or pathfinding in a Worker.

### 4. Mutation pairs and animation logic are duplicated across near-twin components

- `components/WildHoglet.tsx:40–170` and `components/BroodHoglet.tsx:42–170` are nearly identical. Both read from `useHogletStore`, `useHogletPositionStore`, `useNestStore`, query `trpc.workspace.getTaskPrStatus`, run `useCollisionResolvedPosition`, run `useTransitPath`, run `useWalkTo`, compute the same animation key, render essentially the same sprite. They differ in: their parent (flock vs cluster), their starting positions (ring vs orbit), and their accent color.
- The animation-selection logic (lines ~92–105 in both) — `signalReportId ? ANIMATION_ROBO[status] : ANIMATION[status]`, with a walking override — is duplicated character-for-character.

Extract `useHogletVisuals(hoglet, ctx)` returning `{ motionX, motionY, facing, animationKey, fps, prState, title }`. Extract `selectHogletAnimation(status, isWalking, isRoboSignal)` as a pure function and write 16 cases of unit tests. The two components collapse to ~40 lines each.

This isn't critical for extraction, but it's the loudest example of Fowler's "shotgun surgery" risk in the codebase: any change to hoglet visuals today requires touching both files in lockstep.

### 5. Tuning constants are everywhere, configuration is nowhere

Speeds (`SPEED = 150 / 100 / 120` in BuilderSprite / NestSprite / useWalkTo), radii (`36 / 44 / 86 / 100`), animation FPS, build timer, poll intervals (30s signals, 60s feedback, 60s PR-graph, 10s task summary), zoom bounds, easing curves, control-group slot numbers — all hardcoded at point of use, often in two or three files.

Consolidate into one `config.ts` under hedgemony:

```ts
export const HEDGEMONY_CONFIG = {
  speeds: { builder: 150, nest: 100, hoglet: 120, panCamera: 950 },
  radii:  { builder: 36, hoglet: 44, nest: 86, hedgehouse: 100 },
  layout: { wildRingInner: 158, wildRingThickness: 90, broodRadius: 158, obstacleClearing: 28 },
  animation: { buildMs: 1500, moveMarkerMs: 600, fps: { idle: 8, walk: 14, action: 12 } },
  polling: { signalIngestionMs: 30_000, feedbackMs: 60_000, prGraphMs: 60_000, taskSummaryMs: 10_000 },
  camera: { zoomMin: 0.5, zoomMax: 3, animDurationS: 0.42, ease: [0.4, 0, 0.2, 1] as const },
} as const;
```

Cheap to do, big quality-of-life win, prerequisite to having a portable package (you need to be able to tune simulation for the target environment).

---

## Smaller smells worth fixing opportunistically

- **`HedgemonyMapSurface.tsx:122–769`** — 648-line component, same shape as `HedgemonyMapView`. Extract `useMapCamera`, `useMapInput`, `useMapDragSelect`. Untested today; testable once split.
- **Form panels** — `PlaceNestDialog.tsx` (703), `NestDetailPanel.tsx` (875), `HogletDetailPanel.tsx` (447), `SpawnHogletPanel.tsx` (715). All use reducers correctly for draft state, but mix submission, error tracking, and tab composition. Extract `useDraftForm<T>` and `useMutationWithRollback` and they shrink ~40%.
- **`BuilderSprite.tsx` ↔ `useBuilderCoordinator` via `positionRef`** — the sprite writes its current pixel position into a ref each frame; the coordinator reads it at `startWalk()` time. This is temporal coupling. Make it explicit: `startWalk(targetPos: Vec2, fromPos: Vec2)`, and let the caller pass the current position rather than relying on a ref the sprite happens to have populated.
- **Naming bleed**:
  - `WildHoglet` / `BroodHoglet` describe rendering states, not domain entities. Domain has one `Hoglet { nestId: string | null }`.
  - `BuilderCoordinator` is a state machine, not a coordinator.
  - `hedgehogStateByNestId` lives in `NestStore` but is hedgehog state. Move to `HedgehogStore`.
  - `useCollisionResolvedPosition` registers the entity with the loop; it does not resolve anything. Rename to `useCollisionRegistration` and put the resolver behind `collisionResolver.tick()`.
- **`utils/hogletVisualPositions.ts`** — a global mutable registry of six functions wrapping a `Map`. It's a cache hack, not an abstraction. Wrap it as `VisualPositionRegistry { get/set/clear }` (testable, scoped per surface, no globals).

---

## Test coverage: where it's strong, where it's blind

**Strong (≥1 test file each):** pathfinding, collision math, hoglet positioning, world obstacles, builder coordinator state, place-nest-dialog reducer, signal prompt builder, hoglet store, nest store, hoglet position store. 22 test files, 2342 LOC. The algorithm/data-structure layer is in good shape.

**Highest-value missing tests:**

1. **Map-click state machine** — once extracted as `computeMapClickAction()` (Refactor 2 above), ~10 cases covering each `ViewMode × click target` combination. This is the most state-transition-dense logic in the feature, and it's currently completely untested because it lives inline in a 900-line component.
2. **`moveNest` / `adoptHoglet` / `releaseHoglet` rollback paths** — the optimistic update is easy to test against a fake `HogletRepository`; the rollback-on-tRPC-failure path is what would catch a regression silently corrupting the store on transient network errors.
3. **Camera bookmark recall (F5–F7) + control-group recall (Ctrl+1–9)** — the kind of feature that breaks one keypress at a time and you don't notice for weeks.

A general rule: anything that requires mounting `HedgemonyMapView` or `HedgemonyMapSurface` to test today is a candidate for "extract logic, test logic". Don't pursue React-Testing-Library coverage of those components — extract their controllers and unit-test those.

---

## Proposed extraction shape

If the goal is to break out a portable orchestrator, here is the package boundary that the current code is closest to supporting:

```
packages/hedgemony-core/                      (target: zero React, zero Electron, zero tRPC)
  domain/
    types.ts                                   Nest, Hoglet, ControlGroup, Selection, ViewMode...
    repositories.ts                            HogletRepository, NestRepository, ...interfaces
    services.ts                                NestRemoteService, SignalIngestionService, ...
  state/
    HedgemonyController.ts                     orchestrator: mode/selection/control groups
    BuilderStateMachine.ts                     idle/walking/building, no React
    computeMapClickAction.ts                   pure reducer
  simulation/
    SceneTicker.ts                             central deltaMs/frameCount emitter
    CollisionResolver.ts                       pure tick math (already mostly here)
    Pathfinder.ts                              wraps existing A*
    WalkAnimator.ts                            interpolates along a path
  ingestion/
    SignalIngestionService.ts                  ingest one signal → task + hoglet row
    FeedbackRouter.ts                          interface only; impl is in main proc
  config.ts                                    all tuning constants

packages/hedgemony-react/                     (target: current Electron renderer adapters)
  adapters/
    ZustandHogletRepository.ts                 implements HogletRepository against current stores
    ZustandNestRepository.ts
    TrpcNestRemoteService.ts                   implements NestRemoteService over tRPC
    FramerMotionTransport.ts                   maps SceneTicker positions → MotionValue
    DndKitSelectionBehavior.ts                 drag-drop adapter
  components/                                  current components, slimmed
  hooks/                                       thin wrappers over -core

apps/code/                                    (consumes hedgemony-react)
```

`hedgemony-core` would be testable with `vitest` and no DOM at all. A future terminal renderer or server-side simulator would build its own `packages/hedgemony-{ink,server,...}` against the same core interfaces.

To be clear: this is the **target** shape. The actual work is the staged refactor below; you don't move files until the seams exist.

---

## Staged roadmap

Each stage is independently shippable and leaves the app working. Listed in dependency order, not time order.

**Stage 0 — Foundations (no extraction yet, but enables everything)**

- Centralize tuning constants in `features/hedgemony/config.ts`.
- Extract `selectHogletAnimation(status, isWalking, isRobo)` as a pure function with 16-case test.
- Extract `useHogletVisuals(hoglet, ctx)` and collapse `WildHoglet` / `BroodHoglet` onto it.
- Extract `computeMapClickAction()` and rip the inline switch out of `HedgemonyMapView`. Write tests.

**Stage 1 — Invert the data dependency in mutations**

- Define `HogletRepository`, `NestRepository`, and the `*RemoteService` interfaces inside `features/hedgemony/domain/`.
- Implement Zustand-backed and tRPC-backed adapters in the existing store/service files.
- Refactor `moveNest`, `adoptHoglet`, `releaseHoglet`, `handleHogletDrop`, and the subscription initializers to accept those interfaces.
- Now mutations are unit-testable with `InMemoryHogletRepository` and a stub remote service. Add the rollback-path tests.

**Stage 2 — Extract the builder as a state machine**

- Pull builder state out of `useBuilderCoordinator` into a `BuilderStateMachine` class.
- `useBuilderCoordinator` becomes a 30-line React adapter wiring `useState` to the machine's event stream.
- Make the `positionRef` dependency explicit: the machine takes `(target, from)`; React passes the sprite's current pixel via a callback, not a shared ref.

**Stage 3 — Centralize the simulation tick**

- Introduce `SceneTicker` with a single rAF.
- Migrate `AnimatedHedgehog`, the collision resolver, `useWalkTo`, and `usePanCamera` to subscribe to it.
- Keep `framer-motion` as the output transport: the ticker emits `(x, y)`, an adapter writes to `MotionValue`s.
- Test by injecting a `FakeSceneTicker` that steps deterministically.

**Stage 4 — Break out HedgemonyMapView's controller**

- Move mode/selection/subscription-lifecycle logic into a `HedgemonyController` class.
- Map view becomes ≲250 LOC of rendering and hotkey adapters.
- Hotkeys move into `useHedgemonyHotkeys` driven by a binding table; bindings become data, not 45 hand-written `useHotkeys` calls.

**Stage 5 — Physically split into packages**

- Move everything that's now framework-free into `packages/hedgemony-core`.
- React adapters stay in `apps/code/src/renderer/features/hedgemony/` (or move into a new `packages/hedgemony-react`).
- At this point: someone could write `packages/hedgemony-ink` or `packages/hedgemony-headless-runner` against the same core.

Stages 0–2 are useful on their own even if you never do Stage 5. Stage 3 is the only stage gated by something annoying (centralized ticker requires touching most animations at once). Stage 4 is the most code-volume but lowest-risk because it's all mechanical extraction.

---

## When *not* to do this

Worth stating explicitly. The case against extraction:

- The map renderer is the product. If hedgemony only ever ships as an Electron map, the framework coupling is fine. React + Zustand + tRPC + framer-motion is a perfectly cromulent stack to commit to.
- A 900-line component is unpleasant but not blocking shipping.
- "What if we want a different UI" can be a future-self trap. YAGNI applies to architecture too.

The case **for** extraction:

- You explicitly want optionality on the UI (you've said so).
- The geometry/algorithm layer is already pure and tested — half the work is done.
- Several of the refactors (config centralization, builder state machine, map-click reducer, sprite deduplication) pay for themselves on the current React UI even if extraction never happens.
- Test coverage on orchestration logic is currently impossible to write without doing this work first. Stage 1 alone unblocks meaningful regression tests on mutations.

The middle path is to do Stages 0–2, ship them as quality-of-life refactors with no extraction promise, and re-evaluate after.

---

## Decision points for you

1. **Is the extraction goal real?** If yes, Stages 0–4 are the prerequisites. If no, Stages 0–2 are still worth doing on quality grounds and 3–5 can wait.
2. **Do you want a centralized scene ticker (Stage 3)?** It's the most invasive change and the one with the most pervasive payoff (pause, replay, Web Worker, deterministic tests). If the scene stays render-driven, you'll never be able to drive it from outside React.
3. **`WildHoglet` and `BroodHoglet` — merge into one component or keep separate?** Recommendation: merge via `useHogletVisuals` extraction. The "wild vs brood" distinction is parent-and-positioning, not sprite identity.
4. **Do mutations move out of `service/` into a new `domain/` folder, or stay where they are with interfaces injected?** Recommendation: leave the file paths, just invert the dependencies. Moves can come at Stage 5.

---

## Appendix: file-level findings index

- Worst SRP violators: `HedgemonyMapView.tsx:90–912`, `HedgemonyMapSurface.tsx:122–769`, `NestDetailPanel.tsx` (875 LOC), `SpawnHogletPanel.tsx` (715 LOC), `PlaceNestDialog.tsx` (703 LOC).
- Worst framework coupling: `collisionResolution.ts` (hook portion), `useBuilderCoordinator.tsx`, `useSignalIngestion.tsx`, `useWalkTo.ts`, `AnimatedHedgehog.tsx`.
- Worst data coupling: `service/nestMutations.ts`, `service/hogletMutations.ts` (direct `useStore.getState()` calls).
- Duplication: `components/WildHoglet.tsx` ↔ `components/BroodHoglet.tsx`.
- Naming smells: `WildHoglet` / `BroodHoglet`, `BuilderCoordinator`, `useCollisionResolvedPosition`, `hedgehogStateByNestId`.
- Globals to wrap: `utils/hogletVisualPositions.ts`.
- Already clean (use as templates): `utils/pathfinding.ts`, `utils/coordinates.ts`, `utils/hogletPositions.ts`, `components/placeNestDialogReducer.ts`.
