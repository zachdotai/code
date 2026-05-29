# REFACTOR.md — feature-by-feature migration guide

This file is the **procedure** for porting an existing feature into the new package architecture. Read [AGENTS.md](./AGENTS.md) for the layering rules. Read this when you're about to move a feature across.

[MIGRATION.md](./MIGRATION.md) is the running log of what landed and where — useful if you're tracking what's done vs. still to come.

---

## Target shape

Three packages carry the work, organized by runtime. Each one is domain-folder-structured inside.

```
packages/
├── core/                # pure JS. All domain logic. Runs anywhere.
│   ├── sessions/
│   ├── workspace/
│   ├── auth/
│   ├── tasks/
│   └── ...
├── ui/                  # React DOM. Mirrors core's domain folders.
│   ├── sessions/
│   ├── workspace/
│   ├── primitives/      # @posthog/quill wrappers, Button, Modal, Toast
│   └── ...
├── workspace-server/    # Node-only. Host syscalls. Organized by capability.
│   ├── git/
│   ├── fs/
│   ├── pty/
│   ├── process/
│   ├── watcher/
│   └── ...
│
├── platform/            # host-capability interfaces. Locked-down.
├── shared/              # zero-dep primitives, Saga, types. Locked-down.
├── workspace-client/    # TRPC client for workspace-server.
└── api-client/          # HTTP client for Django.

apps/
├── web/         # mounts packages/ui. Provides platform-web adapters.
├── desktop/     # Electron shell. Spawns workspace-server. Provides Electron
│                  platform-adapters. main = shell + adapters. NO business logic.
└── mobile/      # React Native. Imports core/* only. Writes its own RN UI.
```

Per-domain folder shape, by package:

```
core/sessions/                ui/sessions/                  workspace-server/services/git/
├── sessions.ts               ├── SessionList.tsx           ├── git.ts
├── types.ts                  ├── SessionDetail.tsx         └── schemas.ts
└── sessions.test.ts          ├── useSession.ts
                              ├── store.ts        (Zustand)
                              └── SessionList.test.tsx
```

Naming:
- The main file is named after its domain (`sessions.ts`, `file-watcher.ts`, `git.ts`) — not `service.ts`, not `index.ts`. "Service" is DI culture; in core there's no DI and the suffix is meaningless. The repeated folder/file name is intentional: `file-watcher/file-watcher.ts` reads cleaner than `file-watcher/service.ts` and makes grep-by-filename land on the right file.
- `types.ts` — pure TS types, interfaces, enums, constants. No runtime cost. Use when the domain has internal-only types not crossing a tRPC boundary.
- `schemas.ts` — Zod schemas + types inferred from them (`z.infer<typeof xSchema>`). Use when shapes cross a tRPC boundary (workspace-server procedures, anything validated at runtime). The schema is the source of truth; types are inferred from it, never declared separately.
- A domain can have both `types.ts` and `schemas.ts` when it has internal types AND boundary-validated shapes. Most have one or the other.
- Tests colocate next to the file under test (`sessions.test.ts`, `git.test.ts`).

Flat. No `internal/` folder. Split into more files when a single file gets too long to read, grouped by concept.

**What each package owns:**

- **`core/<X>/`** — all business logic. Services, state machines, orchestration, retries, dedup, parsing, error normalization, typed events. Pure JS. Unit-testable with mocked clients.
- **`ui/<X>/`** — React components, hooks that wrap core service calls (`useQuery` over `core.sessions.list()`), and **thin** Zustand stores for pure UI state (selection, open/closed, scroll position, subscription-fed caches). **No business logic**, no multi-step flows, no retries, no orchestration, no `let inFlight: Promise` style dedup. If you find yourself writing those in `ui/`, the code belongs in `core/`.
- **`workspace-server/<cap>/`** — host syscall procedures (git CLI, fs read/write, spawn, watcher). Dumb. No decisions. Called by core through `workspace-client`.

The desktop **main process is not the home of business logic anymore.** It does three things: spawn workspace-server, mount renderer, implement platform adapters.

**Import rules** (biome `noRestrictedImports`):

- `core/<X>/` may import other `core/<Y>/` (via their `index.ts`), `shared/`, `platform/`, `workspace-client`, `api-client`. **Never** `ui/*` or `workspace-server/*`.
- `ui/<X>/` may import `core/*`, `ui/primitives/`, `shared/`. **Never** `workspace-server/*` or other `ui/<Y>/` internals.
- `workspace-server/<cap>/` may import `shared/`, Node modules, and other `workspace-server/<cap2>/` via `index.ts`. **Never** `core/*` or `ui/*` — workspace-server is the host; it knows nothing about business domains. Domains live in `core/` and *call into* workspace-server through `workspace-client`.
- `shared/` and `platform/` import nothing else internal.

---

## Ground rules

- **Don't guess. Flag.** When you can't decide where a piece of code belongs, leave `// TODO(refactor): <question>` and move on. Wrong placement is worse than an open question.
- **Preserve structure during the move.** Same function names, same parameter order, same control flow. The move should diff against the old file cleanly. *Refactoring the logic* happens after, not during.
- **Don't invent new layouts.** Don't create new sibling packages, new abstractions, or new naming conventions mid-move. If the existing structure doesn't fit, raise it — don't bend the move around it.
- **Delete, don't deprecate.** When code moves, the old file is removed in the same change. No shims, no re-exports, no "deprecated" comments.
- **Banned imports in `packages/core`.** No `electron`, no `node:fs`, no `node:child_process`, no `node:net`, no `node:os`, no `node:path`. Pure JS only. Anything you'd reach for there is either a workspace-server procedure or a `@posthog/platform` interface.
- **Don't bundle other work.** Wire-format changes, algorithm rewrites, new features, cosmetic renames — keep them out of the move. They double review surface and obscure what's actually being relocated.
- **Not every feature needs a core module.** `core/` is for domain logic — state machines, retries, dedup, cross-feature coordination, business rules. Features that are pure data-piping (server → useQuery → component) skip `core/` entirely. Don't invent a core file for symmetry; let core stay empty for that feature.
- **Source-smoothing belongs with the source, not in core.** Debouncing a noisy event stream, dedup, bulk-threshold throttling, filtering source-specific noise (irrelevant git dir events, etc.) — these are properties of the *event source*, not domain decisions. They live in the workspace-server procedure that owns the source, so every client gets the smoothed stream for free. Don't put them in core just because they look like "orchestration."
- **Hooks are pure react-query idioms.** `useQuery`, `useMutation`, `useSubscription` over a tRPC procedure — that's the whole hook. No `useEffect` constructing services. No `for-await` over async iterables in a hook body. No imperative subscribe/unsubscribe ceremony with a wrappers map. If you find yourself reaching for those, the orchestration is in the wrong place — push it to wherever the tRPC procedure lives (typically workspace-server) and the hook collapses to 5 lines.
- **`useState`, `useRef`, `useEffect` in a hook are usually a smell.** They mean the hook is holding application state or subscription bookkeeping that should live elsewhere — react-query's cache, a Zustand store, a workspace-server procedure, or just derivation from existing query data. The legitimate uses are narrow: `useRef` for DOM refs (focus, scroll, measurement), `useEffect` for synchronizing imperative browser APIs (event listeners on `window`, `ResizeObserver`, etc.). Anything else — caching a previous value, holding a subscription handle, stashing a callback ref to avoid re-renders, building a wrappers map — means the hook is doing work that belongs upstream.
- **Try framework primitives before reaching for core.** Before extracting a forbidden pattern into a new core module, ask: does react-query / tRPC / Zustand already do this? `useMutation` dedups by mutation key. `useQuery` dedups by query key. `useSubscription` handles lifecycle. tRPC subscriptions invalidate caches. Most "I need a state machine for this" cases dissolve into a single mutation + its `onSuccess`. **Delete the forbidden pattern and use the framework primitive** is the first move. Only reach for a core module when you can't express the orchestration as a mutation/query/subscription — typically a Saga (multi-step with rollback), a long-running protocol (OAuth dance with redirects), or coordination that crosses multiple queries with invariants.
- **Smallest change first.** Try deleting the offending code before introducing a new abstraction. Try moving side effects into an existing `onSuccess` before writing an event bus. Try inlining at the call site before extracting a helper. The refactor PR should land *less* code than it deletes whenever possible. If your change adds a net new package, a new singleton, or a new abstraction layer, justify the line count.
- **Validate the app actually runs.** Typecheck and tests pass on incomplete work all the time. For any user-visible change, open the app and exercise the feature. For background changes, watch logs through one real usage cycle. CI green ≠ feature works.
- **Some main services stay in main forever.** Single-instance lock, window manager, deep-link router, crash reporter, auto-updater, app-lifecycle, anything that *is* the Electron shell. Don't try to migrate these. Mark them explicitly as "host-only" in code comments or a service-categorization doc so nobody wastes time auditing them for a slice.

## Comment markers

Use these consistently. Grep targets matter — follow-up passes hunt for each marker.

- `// TODO(refactor): <reason>` — couldn't translate confidently. Flag and move on.
- `// PERF(refactor): <what was lost>` — used to be in-process, now an RPC round-trip. Benchmark later.
- `// PORT NOTE: <reshape>` — the shape changed beyond a 1:1 move (split into two functions, async boundary moved, etc.). For readers comparing old vs. new.

---

## What moves where

| Today | New home |
|---|---|
| `apps/code/src/main/services/<X>/service.ts` — *business* orchestration: state machines, retries, OAuth flows, cross-feature coordination, business rules | `packages/core/<X>/<X>.ts` |
| Same file — *source smoothing*: debounce, dedup, throttle, batch, source-noise filtering | `packages/workspace-server/services/<capability>/` — alongside whatever procedure produces the noisy events. Don't route through core. |
| Same file — host syscalls (git CLI, fs, spawn, native modules) | `packages/workspace-server/services/<capability>/` (git → `git/`, fs → `fs/`, spawn → `process/`, etc.) |
| `apps/code/src/main/trpc/routers/<X>.ts` | Strict one-liner procedures, registered alongside their service in `workspace-server/services/<X>/`. Orchestrating procedures **disappear** — core (or the workspace-server procedure itself) does that work. |
| `apps/code/src/api/<X>` (Django) | `packages/api-client/<X>` |
| `apps/code/src/renderer/features/<X>/` (UI) | `packages/ui/<X>/` |
| `apps/code/src/renderer/stores/<X>.ts` (thin UI state) | `packages/ui/<X>/store.ts` (still Zustand, still thin) |
| `apps/code/src/main/platform-adapters/<X>.ts` | `apps/desktop/platform-adapters/<X>.ts` |
| Renderer-consumed host capability (auth, notifications, integrations — anything in main that the renderer needs to query/mutate via electron-trpc) | `packages/platform/src/<capability>.ts` interface + `apps/code/src/renderer/platform-adapters/<capability>.ts` adapter that wraps `trpcClient.X.*` |

If the migrated feature is pure data-piping (server → useQuery → component), there's no row to core — that's expected, not a missed step.

**Platform adapters apply in both directions.** The existing 15 interfaces in `packages/platform/src/` are all main-process-consumed (main service calls `IClipboard.write`). The same pattern works for renderer-consumed capabilities: interface in `packages/platform/`, adapter in `apps/<host>/src/<process>/platform-adapters/`, ui/core consume via the interface. This is the path for features that live in main and need to be reachable from ui — there's no separate "electron-trpc-client" package needed; the adapter IS the bridge.

---

## Per-feature procedure

Do these in order. One feature at a time.

1. **Audit.** Grep for the feature. List every file: main service, schemas, router, store, components, hooks, subscriptions, tests. **Also list fan-in**: which other main services consume this one's events or call its methods. The audit is for *you*, not a gate — most features in this codebase have fan-in, and that's not a reason to abandon the slice. See [Coexistence and bridges](#coexistence-and-bridges) for how to handle it.
2. **Identify host calls.** Anything touching git CLI, fs, child-process spawn, native modules, OS APIs. Those become workspace-server procedures.
3. **Sort the rest into one of three buckets:**
   - **Source-smoothing** — debounce, dedup, throttle, batch, noise-filter events from a host source. Goes alongside the source's procedure in `workspace-server/services/<X>/`. Don't route through core.
   - **Business orchestration** — state machines, retries, OAuth flows, cross-feature coordination, business rules, error normalization. Goes in `packages/core/<X>/`.
   - **Neither** — pure data-piping from a server query to a component. There's no core module to write. Skip ahead to step 6.
4. **Define the workspace-server procedures first.** Strict one-liners over service methods. Zod input + output, schemas in `workspace-server/services/<X>/schemas.ts`.
5. **(If core applies)** Port business orchestration to `packages/core/<feature>/<feature>.ts`. Pure JS. Constructor injection of `workspace-client` / `api-client` — **no Inversify in core.** Unit test the pure parts directly (extract pure functions for debouncing, drainage, predicates) — don't try to test the async iterable wiring.
6. **Wire the UI.** Hook in `packages/ui/features/<feature>/` is a thin `useQuery` / `useMutation` / `useSubscription` over the tRPC procedure. No `useEffect` / `useRef` / `useState` ceremony. If you reach for those, the orchestration is in the wrong place — push it upstream and try again.
7. **Delete the old main service and router.** No shims, no re-exports — unless coexistence is genuinely needed for fan-in consumers ([Coexistence and bridges](#coexistence-and-bridges)).
8. **Apply in-slice cleanups.** See below.
9. **Add a MIGRATION.md entry.** What moved, what was cleaned, what was deliberately left, what the retirement condition is for any bridge.

---

## Canonical shape for features with real orchestration

When a feature genuinely needs core (multi-step Saga, OAuth dance, cross-query invariants — not just "we already had a forbidden pattern there"), use this shape. The **focus** port is the worked example.

```
packages/core/src/<feature>/<feature>.ts
  └─ export interface <Feature>ControllerDeps { ... }   // narrow, feature-scoped
  └─ export class <Feature>Controller {
       constructor(private deps: <Feature>ControllerDeps, ...) {}
       async enableX(input): Promise<XResult>          // methods DO things, RETURN results
       async disableX(input): Promise<XResult>         // no internal state held about the domain
     }

apps/code/src/renderer/stores/<feature>Store.ts
  └─ const controller = new <Feature>Controller({       // module-scope singleton, OK because stateless
       methodA: (...) => trpcClient.X.a.mutate(...),    // each dep: one-line trpc wrap
       methodB: (...) => trpcClient.X.b.query(...),
       ...
     }, logger);
  └─ export const use<Feature>Store = create<...>()((set, get) => ({
       session: null,                                    // pure UI state
       isLoading: false,
       enableX: async (input) => {
         set({ isLoading: true });
         const result = await controller.enableX(input);
         set({ isLoading: false, session: result.success ? result.session : get().session });
         return result;
       },
       // ... thin actions: call controller, set state from result
     }));
```

**Why this shape:**

- **Controller is stateless.** It orchestrates. Domain state lives where react can render it (store / react-query cache). The controller never holds `this.session` or `this.user` — those would be a second source of truth.
- **Module-scope `new Controller(...)` is fine** because the controller is stateless and its deps are trpc-bound (which is also a singleton). The forbidden "store owning a singleton with state" pattern doesn't apply.
- **Deps are feature-scoped, defined in core.** Not a global platform interface, not a re-export from the trpc client. ~20-30 narrow methods the controller actually uses. The renderer adapter is dumb one-line wraps over `trpcClient.X`.
- **Store actions are call-controller-then-set.** No multi-step flow in the store. No `let inFlight` dedup. No cross-store reach-ins (those move to the controller, or to mutation `onSuccess` if simple).
- **No event bus.** State changes via store updates after each action returns. React-query consumers react via cache invalidation (the store action can invalidate after success).

**When this shape applies:**

The feature has at least one of:
- A Saga (multi-step with rollback) — e.g., focus enable: stash, checkout, save session, on failure unstash and restore
- A long-running protocol — OAuth dance with redirects, multi-round handshake
- An invariant that spans multiple queries — e.g., "if A is true, B must also be refreshed"
- A state machine genuinely complex enough that expressing it as one mutation `onSuccess` is hostile

If none of those apply — if the orchestration is "call endpoint, set state from result" — the feature **doesn't need core**. Use `useMutation`/`useQuery` directly. Don't invent a controller for symmetry.

**When this shape does NOT apply:**

- Pure data-piping (server query → useQuery → render). No core. The hook is 5 lines of `useQuery` over the tRPC procedure.
- Source-smoothing (debounce, dedup of noisy events). Goes in the workspace-server procedure that owns the source, not in core.
- Plain auth state that's already served by `trpc.X.getState`. React-query's cache IS the state. Don't shadow it with a stateful core class.

---

## Coexistence and bridges

This codebase is heavily inter-coupled — most main-process services consume events from, or call methods on, other main-process services. A pure "one feature, one slice, delete the old" port is the exception, not the rule. Expect coexistence; design for it.

**The default pattern: bridge the old module.** When you move a feature's guts into `packages/core/<X>/` + `packages/workspace-server/<cap>/` + `packages/ui/<X>/`, the old `apps/code/src/main/services/<X>/service.ts` doesn't have to die in the same change. Keep it as a thin shim that:

- constructs the new core module (or the workspace-server-backed client) at boot,
- forwards the events and methods its in-process consumers already depend on,
- holds no logic of its own — just delegation.

The shim is the seam. Other main services keep depending on it unchanged. As each of *those* services migrates later, they drop their dependency on the shim. When the last one is gone, delete the shim.

Mark the shim file with a one-liner at the top: `// PORT NOTE: shim — delegates to <new path>. Delete when <list of remaining consumers> migrate.` That tells the next reader (or agent) exactly what's keeping it alive and what unblocks its removal.

**Skip the shim when the new class is signature-compatible with the old DI binding.** If the new `core/<X>/service.ts` already exposes the same methods and event API the old service did, you don't need a shim at all — just late-bind the new class to the existing DI token at bootstrap. The pattern (taken from the file-watcher migration):

```ts
// In main bootstrap, after the new class's async prereqs are ready:
const connection = await wsServer.start();
const workspaceClient = createWorkspaceClient(connection);
container
  .bind(MAIN_TOKENS.FileWatcherService)
  .toConstantValue(new CoreFileWatcherService({ workspace: workspaceClient }));

await initializeServices(); // existing consumers resolve here, unchanged
```

Remove the static `container.bind(...).to(OldClass)` from `container.ts`. Consumers keep `@inject(MAIN_TOKENS.X) private x: X` — only the *type import path* changes (from `../X/service` to `@posthog/core/X/service`). The DI token now points at the core class; no delegation layer, no event re-emission, no shim file to delete later.

This works when (a) the core class's public API is a strict superset of the old one, (b) there's a clean bootstrap point where the async prereqs are known to be ready, and (c) nothing tries to resolve the token earlier than that point. Verify (c) by grepping the token — `services/index.ts` side-effect imports, top-level `register*Handlers()` calls, etc. should not transitively `container.get` it before your bind runs.

**When the feature itself is too big to port in one slice** (the renderer-side `sessions` module is the canonical example — thousands of lines, owns state machines, holds subscriptions, reaches into other stores), carve it into smaller user-visible slices: "list sessions," "create session," "session detail view," "session permissions stream." Each slice is its own pass through the per-feature procedure, with its own MIGRATION.md entry. Pick read-only slices before mutations, mutations before subscriptions.

Rules that hold for both bridging and slicing:

- **Don't add new code to the old module.** New logic goes in the new home. The old code is in maintenance mode for the duration.
- **Don't import across the seam in the wrong direction.** New `core/` code never imports from the old `apps/code/...` module — the dependency goes old → new, not new → old. If `core/` needs a helper that still only lives in the old module, copy it (mark with `// PORT NOTE: duplicated from <old path>, removed when <slice> lands`).
- **Track open coexistence in MIGRATION.md.** Each entry says what's still in the old location and what triggers its removal — fan-in waiting to migrate, shims keeping the boot path stable, helpers temporarily duplicated.
- **Coexistence is the cost, not the goal.** Every shim and duplicate is a debt with a known retirement condition. If you find one without a retirement condition, that's the layering problem — name it.

If you genuinely can't find any tractable slice (the feature is so entangled that even a shim doesn't isolate the new code), that's a layering problem, not a porting problem. Raise it before starting.

---

## Resolving forbidden patterns

When you encounter a forbidden pattern (see AGENTS.md) inside the code you're moving, fix it as part of the move. Don't extend the pattern, don't relocate it as-is. The technique for each:

**Multi-step flow in a store.** (OAuth dance, token refresh, polling, `let inFlightX: Promise | null` dedup.) Extract the flow as a class method on a new core module. Inject `workspace-client` / `api-client` via constructor. The class owns the dedup promise, the retry loop, the state machine. The store keeps a single `status` field and a thin action that calls the method. Test the core class with mocked clients.

**Cross-store reach-in.** (`useOtherStore.getState().something()` inside a store action.) Find the system event that triggered the reach-in. Make core emit a typed event for it. Each affected store subscribes via its feature's `subscriptions.ts` registrar and reacts independently. No store imports another.

**Business client held in a store.** (`client: createClient(region, projectId)` field.) Construct the client in core, keyed by whatever id the store cared about. The store keeps the serializable id (`activeProjectId: string`). Components ask core for the client when they need it.

**Store owning a subscription.** (`let globalSubscription = trpcClient.X.subscribe(...)` at module scope.) Move the subscribe call into the feature's `subscriptions.ts` registrar, wired once at app boot. The store exposes a setter the registrar calls with each event.

**Store owning a domain timer.** (`window.setTimeout(() => removeClone(id), 3000)`.) The lifecycle belongs in core. Core schedules the cleanup and emits a `Removed` event when it fires. Store reacts to the event like any other.

**Custom hook orchestrating multiple queries.** (Two `useQuery` calls + a `useMemo` merge.) Replace with one core function that does the merge and exposes a single shape. Component uses one `useQuery` (or a derived hook over the single core call).

**Imperative `trpcClient` from a component.** (`useEffect(() => trpcClient.X.query().then(setState))`.) Replace with `useQuery`. If the component needs the result imperatively for a side effect, use `queryClient.fetchQuery` rather than reaching past the cache.

**tRPC router bypassing its service to call a repository.** Move every repository call into a service method. Router calls service. Never router → repository.

**tRPC router with inline business logic.** (Math, time arithmetic, conditional branching inside `.mutation`/`.query`.) Move the logic into a service method (workspace-server) or a core function. The router becomes a one-line forwarder.

**tRPC router with no backing service.** Create the service. Router shrinks to one-liners over it. If the existing router is a junk drawer (`os.ts`), split it: workspace-server procedures for host syscalls, `@posthog/platform` interfaces for host capabilities.

**`container.get(X)` inside a service method.** That's a circular-dep dodge. Either: (a) split the service — the part X needs probably belongs in a third module both depend on, or (b) invert the relationship via events — X emits, the dependent listens. Never paper over with `container.get`.

**Renderer service fetching domain data or coordinating tRPC.** Move the whole module to `packages/core/<feature>/`. If parts of it are genuinely UI mechanics (drag-and-drop, focus rings), split those off into a thin renderer-side helper.

**Platform adapter with business logic.** Strip the decisions out. Adapter does one syscall / one host-API call and returns. The decision lives in a service that depends on the adapter via its interface.

**`import from "electron"` in service code.** Define the capability as an interface in `packages/platform` (`INotifier`, `IClipboard`, etc.). Service depends on the interface. Per-app adapter implements it.

If you find debt that isn't a forbidden pattern and isn't a layering fix, **leave it.** Note it in MIGRATION.md and move on.

---

## Recommended order

1. **Read-only, no subscriptions** — done. diff-stats.
2. **Read-only, subscription-based** — done. file-watcher proved the SSE streaming transport (workspace-client `splitLink` + `httpSubscriptionLink`, hono server accepting `?secret=` query). Source-smoothing lives in workspace-server, hook is pure `useSubscription`.
3. **Write paths with Saga orchestration** — done. focus proved the [canonical core-bearing shape](#canonical-shape-for-features-with-real-orchestration): stateless `FocusController` in core with feature-scoped deps interface, thin store wraps `trpcClient.X.*` as deps adapter, store actions call controller and set state from result. This is the reference for any future feature that genuinely needs core.
4. **Renderer-side platform adapter** — next. Auth or notifications. Establishes the pattern for the ~25 host-capability services to follow: `packages/platform/src/<cap>.ts` interface + `apps/code/src/renderer/platform-adapters/<cap>.ts` adapter wrapping `trpcClient.X.*` + ui consumes via context. Unlocks the bulk of the remaining main services.
5. **Terminal / pty proxying.** Most ambitious. Tests the full pipeline including binary data.

Patterns now baked into the ground rules from prior slices:
- Source-smoothing belongs with the source (not core) — file-watcher.
- Hooks are pure react-query idioms — file-watcher.
- Stateless controller + thin store + dumb deps adapter for features that need core — focus.
- Try framework primitives before reaching for core; most "I need a state machine" cases dissolve into `useMutation` + `onSuccess`.
- Platform adapters apply in both directions; the existing 15 are main-consumed, the next ones are renderer-consumed.

Apply these on every slice going forward.

---

## MIGRATION.md format

Add an entry as each feature lands. Ten lines max:

```
## 2026-MM-DD — <feature>

- Moved: `apps/code/src/main/services/<X>/` → `packages/<core|workspace-server>/<X>/`
- Cleaned: <one line per layering fix>
- Left as-is: <one line per deliberate skip>
- New import path: `<new path>` (was `<old path>`)
```
