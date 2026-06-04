---
name: implement-inbox-sync
description: Third step of the inbox-to-cloud sync workflow. Executes the manifest from `/plan-inbox-sync`, dispatching parallel sub-agents per the slicing plan and then integrating their work in the central cloud scene and logic. Owns the desktop→cloud translation (Quill/Radix → LemonUI, Zustand/TanStack Query → Kea, TanStack Router → scenes/urls). Use as part of `/sync-inbox-to-cloud`, or standalone to execute a hand-rolled manifest.
---

# Implement the inbox sync

This is sub-skill 3 of `/sync-inbox-to-cloud`. Re-read the parent skill's hard rules at `/Users/twixes/Developer/code/.claude/skills/sync-inbox-to-cloud/SKILL.md` before starting.

## Goal

Apply the manifest from `/plan-inbox-sync` to the cloud Inbox. Parallelize where the plan says so; integrate centrally.

## Phases

### Phase A — Dispatch parallel sub-agents (if planned)

**Before dispatching sub-agents**, the orchestrator verifies cloud has every non-trivial dependency the desktop side uses. Grep `~/Developer/posthog/frontend/package.json` for each library that appears in desktop imports — typical candidates: `framer-motion`, `tiptap`, `xterm`, `codemirror`, `react-virtualized`. For any missing library, decide upfront how slices should handle it:

- **Add the dep** to cloud's `package.json` (small, well-maintained libraries).
- **Substitute** with a cloud-available alternative — and brief sub-agents on the exact substitution (e.g. `framer-motion <motion.div animate={{x:N}}>` → `<div style={{transform: 'translateX(Npx)', transition: '...'}}>`).
- **Skip the visual** and brief sub-agents to surface it as Open Question.

The wrong move is to let each sub-agent guess. Put the decision in the sub-agent prompt so all slices substitute the same way.

Read `/Users/twixes/Developer/code/.claude/skills/sync-inbox-to-cloud/references/parallelization.md` for the full pattern. Short version:

- Dispatch up to 4 sub-agents in a single message (parallel Agent tool calls).
- Each sub-agent owns a disjoint file scope and creates new files only in their owned subdirectory.
- Sub-agents MUST NOT touch the central scene entry-point file(s) or the central composing logic.
- Each sub-agent's prompt inlines the relevant hard rules and the translation rules from `references/translation.md`.
- Each sub-agent's prompt names the files they own AND lists the files owned by other slices as "do not touch".

**Slice prerequisites.** If one slice produces types, utils, or API wrappers consumed by other slices, treat it as a sequential prerequisite — dispatch it alone, wait for it to return, then dispatch the dependents in parallel. The naive "everything parallel" pattern works only when slices share no contracts; in practice a Foundation slice (types + API + badges + utils) almost always exists. Default order: Foundation → wait → {feature slices in parallel} → orchestrator integration.

If the plan said don't parallelize (small re-sync, just-shifted IA, plan has only 1-2 cohesive areas), implement sequentially. The translation rules in `references/translation.md` apply either way.

### Phase B — Integrate

The orchestrator (you) owns the central integration files. After sub-agents return:

- **Write/rewrite the central cloud scene entry-point file** to compose the new subcomponents from sub-agents. If desktop's IA has shifted (e.g. introduced new tabs), this is where the new top-level shape lands.
- **Write/rewrite the central composing Kea logic** to `connect` to the sibling logics, handle routing (`urlToAction` / `actionToUrl`), and own cross-slice scene state.
- **Add new TS wrappers in `frontend/src/lib/api.ts`** if any slice surfaced an existing backend endpoint without a wrapper. Verify the endpoint exists first (grep `products/signals/backend/views.py`).
- **Update `urls.ts` and `scenes.ts`** if desktop's IA introduced new routes (new tabs, new subroutes).
- **Update `types.ts`** with any new shared types.

### Phase C — Quick smoke-check

Before handing off to `/finalize-inbox-sync`, do a quick visual scan of your work:

- Did any sub-agent return saying it had to touch a file outside its scope? If so, you have an integration mess — re-plan that slice or absorb the file into the orchestrator's scope.
- Did any sub-agent return saying it stubbed Coming soon™ on something that isn't live chat? Revert that — wire it properly.
- Did any sub-agent return saying it skipped work? Re-dispatch with stronger framing — there is no skip.

## Translation

See `references/translation.md` for the desktop→cloud mapping covering:

- Component library (Radix Themes + Quill → LemonUI)
- Icons (Phosphor → `@posthog/icons`)
- State management (Zustand + TanStack Query → Kea)
- Routing (TanStack Router → scenes / urls / sceneTypes)
- API (already shared; just frontend wrappers in `lib/api.ts`)
- Persistence (Zustand `persist()` → Kea `{ persist: true }` per reducer)
- Hedgehogs / empty-state assets (`lib/components/hedgehogs`)
- Analytics events (`posthog.capture(...)` from `posthog-js`; mirror desktop event names verbatim)

## Next step

**Do not stop here.** The parent `/sync-inbox-to-cloud` is a single uninterrupted workflow. Immediately invoke `/simplify` using the Skill tool, passing it the list of cloud files you touched as scope. Do not summarize the work and wait, do not produce a report yet (that's step 5), do not pause — chain straight to the next step.
