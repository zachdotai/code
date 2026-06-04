# Parallelizing the sync with subagents

The Inbox port is slice-able by feature area. Each slice can be implemented in parallel by a dedicated subagent **if** its file scope is disjoint from every other slice. Slices that share files (the scene's entry-point file, the central composing logic) must be serialized.

This doc describes the *pattern* — concrete slices must be derived fresh on each run from desktop's current organization. **Do not** hard-code the slice list here; the desktop Inbox is mid-evolution and any prescriptive table will rot.

## The pattern

```
Phase 1 (sequential, orchestrator):
    - Enumerate desktop Inbox files on this run
    - Read entry-point files on both sides
    - Identify cohesive UI areas (mirroring desktop's organization)
    - Design cloud directory structure
    - Produce a manifest: slice → owned files, dependencies, success criteria

Phase 2 (parallel, N subagents):
    - Each subagent owns a disjoint set of NEW files
    - Subagents create new components in their owned subdirectory
    - Subagents create new Kea logics (sibling files, not edits to the central logic)
    - Subagents do NOT touch the central integration files (scene entry-point + central composing logic)
    - Subagents do NOT touch each other's files
    - Each subagent runs typecheck on its own files before returning

Phase 3 (sequential, orchestrator):
    - Rewrite the scene entry-point to compose new subcomponents
    - Rewrite/`connect` the central logic to the sibling logics
    - Wire up urlToAction / actionToUrl across logics
    - Update routing if desktop's IA shifted (new tabs, new urls)

Phase 4 (sequential, orchestrator):
    - Run typecheck + format
    - Invoke the `simplify` skill on touched files
    - Re-run typecheck after simplify
    - Produce the final report
```

## How to choose slices on this run

Derive slices from the desktop Inbox's *current* organization, not from a fixed table. The rules:

1. **One slice ≈ one cohesive UI area** on desktop. Examples of cohesive areas (illustrative — what actually exists on desktop varies):
   - A top-level tab (Pull requests / Reports / Agents / etc.) → one slice per tab
   - A drawer-shaped configuration surface ("Configure agents") → one slice
   - A floating affordance ("Chat with Inbox") → one slice (probably stubbed Coming soon™)
   - A standalone area like a filter/sort bar, an empty-state set, a notification banner family → one slice
   - The list of items + their row presentation → one slice
   - The detail view for a selected item → one slice
   - Selection / multi-select / keyboard navigation as a behaviour → one slice
   - Analytics / engagement tracking as a cross-cutting concern → one slice

   These are *examples* of cohesion patterns. Map them onto whatever the desktop Inbox actually looks like today. If desktop's IA is tab-based, slices align with tabs. If desktop is split list+detail, slices align with list vs detail. If desktop has both, slice along whichever cut produces the cleanest disjoint file scopes.

2. **File-scope disjointness is mandatory.** Two subagents must never write to the same file. The central scene entry-point and the central composing logic are reserved for the orchestrator.

3. **Sibling Kea logics are encouraged.** Don't have all subagents pile state into one giant logic file. Each cohesive area gets a sibling Kea logic (`<area>Logic.ts`), and the orchestrator `connect`s them in the central logic.

4. **3–6 slices is the sweet spot.** Fewer than 3 — sequential is simpler. More than 6 — coordination cost dominates. If desktop has many small features, group them into 3–6 cohesive slices rather than one slice per feature.

## What the orchestrator owns

Two locations are always the integration surface and only the orchestrator touches them:

- The cloud Inbox scene's **entry-point file(s)** — whatever composes the top-level layout
- The cloud Inbox's **central composing Kea logic** — handles routing (`urlToAction` / `actionToUrl`), top-level scene state, and `connect`s to the area logics

The orchestrator may also:

- Move existing cloud files into a new subdirectory layout when desktop's organization has shifted
- Add new TS wrappers in `frontend/src/lib/api.ts` if a slice needs a wrapper on an existing backend endpoint
- Add a few small new types to `types.ts`
- Add or remove URL paths in `urls.ts` and `scenes.ts` if desktop's IA introduces new tabs / subroutes

## Subagent prompt template

Each subagent gets a prompt that includes:

1. **Their slice number + name** (derived from this run's manifest)
2. **Owned files (exhaustive list)** — files they may create or edit. Anything else is read-only.
3. **Read-from list** — desktop files they should inspect to derive behavior.
4. **The inlined hard rules from SKILL.md** — they may not have time to read the full skill, so inline the directly-relevant rules:
   - Cloud uses LemonUI (`@posthog/lemon-ui` + `lib/lemon-ui/*`), never Quill/Radix; icons from `@posthog/icons`
   - Cloud uses Kea (with `{ persist: true }` for persisted state)
   - Desktop is source of truth for UI/UX defaults and behavior
   - Backend is source of truth for enum values (grep `products/signals/backend/{models,serializers,views}.py`)
   - Live-chat-only Coming soon™ stubs; everything else gets ported, including task-kickoff actions
   - Mirror desktop directory structure for this slice's area
   - Match every polish detail in their slice's area
5. **A "do not touch" list** — the central files (scene entry-point + central logic) and other slices' owned files. Make this explicit; list paths.
6. **Specific output contract** — what the orchestrator expects in return: list of files created, list of exported names from the slice's components / logic, key actions/values from the slice's Kea logic, any backend endpoints discovered missing (do not add them), and any skill ambiguities.

Example shape:

```text
You are sub-agent #<N> for the sync-inbox-to-cloud skill, owning the "<slice name>" slice.

YOUR JOB: Implement the cloud-side equivalent of the following desktop files, using cloud
conventions (LemonUI + Kea + Tailwind). Match every polish detail.

DESKTOP FILES TO PORT (read-only):
- /Users/twixes/Developer/code/apps/code/src/renderer/features/inbox/<file>
- ...

YOU MAY CREATE OR EDIT (cloud side):
- /Users/twixes/Developer/posthog/frontend/src/scenes/inbox/<file>
- ...

YOU MUST NOT TOUCH:
- /Users/twixes/Developer/posthog/frontend/src/scenes/inbox/<central scene file>
- /Users/twixes/Developer/posthog/frontend/src/scenes/inbox/<central logic file>
- Files owned by other slices (list below)

RULES (binding):
- LemonUI (`@posthog/lemon-ui`, `lib/lemon-ui/*`). Never import `@radix-ui/themes`, `@posthog/quill`, `@phosphor-icons/react`. Use `@posthog/icons` for icons.
- Kea logics with auto-generated `*LogicType.ts`. Persisted state uses `{ persist: true }` per reducer.
- Desktop is the source of truth for defaults, copy, ordering, behavior. Match it exactly.
- Components matter: one component per desktop component, same names, translated to LemonUI.
- Polish is part of the port: layout, search bar orientation, sticky headers, hover states, responsive design — all of it.
- No live-agent-chat surfaces. Only the live-chat ("Discuss" / "Chat with Inbox") feature stubs to "Coming soon™". Everything else gets fully ported. Create-PR-style task-kickoff actions are NOT chat — wire them to `api.tasks.*`.
- No backend changes. Adding a TS wrapper in `frontend/src/lib/api.ts` over an existing backend endpoint is fine; adding a new endpoint is not.

OUTPUT CONTRACT — when you finish, return:
- List of files created/modified (paths)
- List of exported component names + their props signatures (so the orchestrator can compose them)
- List of exported Kea logic names + their key actions/values (so the orchestrator can `connect` to them)
- Any backend endpoints you discovered are missing (do not add them; surface them)
- Any skill ambiguities you hit
```

## Concurrency budget

Run **up to 4 subagents in parallel** in a single `Agent` tool batch. More than that risks rate limiting and makes integration harder to reason about. If you have 6 slices, run in 2 batches of 3.

Between batches, the orchestrator does **not** integrate yet — that's Phase 3. Between batches, the orchestrator can do quick `Read` calls to confirm each slice's output before dispatching the next batch.

## Failure modes to avoid

- **Two subagents both editing the central scene file or central logic** — sequential merge conflict. The orchestrator owns those files; subagents never touch them.
- **Slice-name / component-name collisions** — when designing the manifest in Phase 1, pre-assign exported names; honor them.
- **Subagent skipping work because "it's structural"** — same anti-pattern as the single-agent version. Each subagent prompt must include the "no scope escape hatch" rule.
- **Subagents inventing backend endpoints** — they must `grep` `products/signals/backend/views.py` before assuming an endpoint is missing. Surface missing endpoints; do not invent them.
- **Skipping Phase 4 (`simplify` skill)** — parallel work tends to leave duplicated helpers. Always run `simplify` at the end.
- **Hard-coding today's IA into the slice manifest** — derive slices from desktop's *current* shape, not from a fixed list.

## When NOT to parallelize

Skip parallelization and run sequentially if:

- The cloud Inbox is already 80%+ synced (the orchestrator can finish the last few items faster than splitting them up)
- You're doing a re-sync after a small desktop change (only 1–2 cohesive areas have any work)
- You're not sure the slicing is disjoint — sequential is always safe, parallel is only sometimes safe
- Desktop's IA has just shifted dramatically (e.g. moved from list+detail to tabs) — the first sync after a shift is best done sequentially so the orchestrator can think through the new shape holistically; subsequent syncs can parallelize
