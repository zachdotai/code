---
name: plan-inbox-sync
description: Second step of the inbox-to-cloud sync workflow. Takes the inventory from `/inspect-inbox-surfaces` and produces a sync manifest — which desktop features get ported, which get stubbed Coming soon™, which reuse existing cloud surfaces — plus a slicing plan for parallel sub-agents. Use as part of `/sync-inbox-to-cloud`, or standalone to refresh a manifest after desktop reorganized.
---

# Plan the inbox sync

This is sub-skill 2 of `/sync-inbox-to-cloud`. Re-read the parent skill's hard rules at `/Users/twixes/Developer/code/.claude/skills/sync-inbox-to-cloud/SKILL.md` before starting — they constrain every decision below.

## Goal

Produce two artifacts in working memory:

1. **A per-feature manifest** — for each desktop feature, the decision: port / stub Coming soon™ / link to existing cloud surface.
2. **A parallelization plan** — 3-6 disjoint slices, each owned by a sub-agent, with one orchestrator integration phase afterwards.

## Steps

### 1. Diff feature-by-feature

Walk through the inventory from `/inspect-inbox-surfaces`. For each desktop feature, ask:

- Does cloud have it?
- If yes, is it complete? What polish details are missing?
- If no, what would porting it touch?

Don't pre-decide based on "does cloud have a place for this" — desktop is the source of truth, and cloud may need a new place.

### 2. Decide per feature

For each desktop feature, pick exactly one of:

- **Port** — implement on cloud using cloud conventions (LemonUI + Kea). This is the **default decision** for everything. If it feels structural, do the structural rewrite.

- **Stub Coming soon™** — ONLY for features that require a live agent chat surface. Today that's the Discuss action (and any equivalent floating chat-with-inbox affordance from desktop's evolving IA). One disabled affordance with a tooltip. **Task-kickoff actions are NOT live chat** and don't stub.

- **Port the linkage + reuse existing cloud surface for run-log viewing** — where a desktop feature links a SignalReport to its tasks, port the linkage UI on the cloud Inbox side and link out to `products/tasks/frontend/TaskDetailPage.tsx` / `TaskSessionView.tsx`. The linkage on the inbox side is the port; only the run-log viewer is reused.

**"Skip" is not a valid decision.** Neither is "defer to follow-up PR." If a feature feels too large to port in one chunk, split it across multiple sub-agents — but ship all of them in this run. The only items that may legitimately not get ported are things that depend on a desktop-only OS API with no cloud analogue; even then, port the visible part and stub the OS bit.

### 3. Plan the cloud directory shape

Look at desktop's current organization (subdirectories, component splits, hook/store/util groupings). Plan an analogous shape on cloud:

- Cloud subdirectories mirror desktop's (e.g. if desktop has `components/list/`, `components/detail/`, `components/config/`, cloud gets the same — adapted to whatever desktop's current organization actually is)
- Every named component on desktop gets a same-named component on cloud (translated to LemonUI)
- Sibling Kea logic files per cohesive area (`<area>Logic.ts` with generated `<area>LogicType.ts`)
- Pick names that match desktop's structure on this run — do not carry over names from prior syncs if desktop has reorganized

### 4. Plan the slicing for parallel sub-agents

Read `/Users/twixes/Developer/code/.claude/skills/sync-inbox-to-cloud/references/parallelization.md` for the pattern.

Identify 3-6 cohesive UI areas with **disjoint file scopes**. The orchestrator (in the next sub-skill) will own the central scene file(s) and central composing logic; each slice gets a sub-agent that owns its own subdirectory + sibling logic.

Slice cohesion patterns (examples — derive from desktop's actual shape on this run):

- One slice per top-level tab (if desktop has tabs)
- One slice for a drawer-shaped configuration surface
- One slice for selection / multi-select / keyboard navigation as a cross-cutting behaviour
- One slice for analytics / engagement tracking
- One slice per cohesive area like list-rows, detail-view, sources/setup, autonomy-config

3-6 is the sweet spot. Fewer → just run sequentially. More → coordination cost dominates.

### 5. Validate the plan against the hard rules

Sanity check before handing off:

- Did you stub anything that isn't live chat? Revert that decision to "port".
- Did you decide to skip anything that should be ported? Revert.
- Are slice file scopes truly disjoint? If two slices reference the same file, one of them needs to own it (or it needs to belong to the orchestrator).
- Did you pick cloud directory names that mirror desktop's current organization (not a stale prior structure)?
- For any feature you marked "needs new wrapper in `lib/api.ts`", did you verify the backend endpoint exists? Grep `products/signals/backend/views.py`.

## Output

Two artifacts in working memory, suggested format:

**Per-feature manifest** (one bullet per feature):

- `<feature name>` — port to `<cloud destination file>`
- `<feature name>` — stub Coming soon™ at `<cloud destination file>` (live chat — verbatim reason)
- `<feature name>` — port linkage to `<cloud destination file>`; reuse `<cloud existing surface>` for run-log viewing

**Slicing plan** (one bullet per slice + one for the orchestrator):

- **Slice A — `<name>`**: owns `<list of cloud files this slice creates>`; reads from `<list of desktop files this slice ports>`; sub-agent type: `general-purpose`
- **Slice B — `<name>`**: ...
- **Orchestrator integration**: will touch `<central cloud scene file>`, `<central cloud logic file>`, `frontend/src/lib/api.ts` (for new wrappers on existing backend endpoints), `urls.ts` / `scenes.ts` (if desktop IA introduces new routes)

## Next step

**Do not stop here.** The parent `/sync-inbox-to-cloud` is a single uninterrupted workflow. Immediately invoke `/implement-inbox-sync` using the Skill tool. Do not summarize the manifest and wait, do not ask the user for approval, do not pause — chain straight to the next step.
