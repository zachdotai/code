---
name: inspect-inbox-surfaces
description: First step of the inbox-to-cloud sync workflow. Lists the PostHog Code desktop Inbox feature directory and the PostHog Cloud Inbox scene directory, reads each side's entry-point files, and produces a structured inventory the planning step consumes. Use as part of `/sync-inbox-to-cloud`, or standalone when you need a fresh map of both Inboxes.
---

# Inspect both Inbox surfaces

This is sub-skill 1 of `/sync-inbox-to-cloud`. Re-read the parent skill's hard rules at `/Users/twixes/Developer/code/.claude/skills/sync-inbox-to-cloud/SKILL.md` before starting — they are binding.

## Goal

Produce an inventory of:

- What lives on the desktop side (source of truth)
- What lives on the cloud side (target, partially synced from prior runs)
- Which shared backend wrappers exist

The next sub-skill (`plan-inbox-sync`) consumes this inventory to produce the sync manifest.

## Steps

### 1. Enumerate the desktop Inbox

Always start with a fresh listing — do not assume the file set from a prior run.

```sh
ls /Users/twixes/Developer/code/apps/code/src/renderer/features/inbox/
find /Users/twixes/Developer/code/apps/code/src/renderer/features/inbox -type f \( -name "*.ts" -o -name "*.tsx" \) | sort
```

### 2. Read the desktop entry-point files in full

Find the obvious shell component(s) — the file the router points at, plus the top-level layout file(s). Names will change over time; look for what's currently the entry point. Today (verify): `components/InboxView.tsx` and `components/InboxSignalsTab.tsx`, but **do not** assume these names will persist.

### 3. Read a representative file from each sub-area

For each of the groups you see when you list the desktop dir, read one or two representative files to understand the shape. Don't read every file — read enough to identify the contract of each area.

Typical groupings (illustrative, derive on this run):

- Entry / layout shells
- List / report rendering
- Detail / per-report views
- Configuration & autonomy surfaces (sources dialog, signal source toggles, team config, user autonomy config, scout / responder management as those emerge)
- Empty / loading / setup states
- Hooks (data fetching, deep-link sync, engagement tracking, etc.)
- Stores (filter state, selection, sidebar widths, etc.)
- Utils (prompt builders, filter helpers, constants)

If desktop's IA has shifted (e.g. new top-level tabs like Pull-requests / Reports / Agents), the groupings shift with it. Mirror what's actually there.

### 4. Enumerate the cloud Inbox

```sh
ls /Users/twixes/Developer/posthog/frontend/src/scenes/inbox/
find /Users/twixes/Developer/posthog/frontend/src/scenes/inbox -type f \( -name "*.ts" -o -name "*.tsx" \) | sort
```

Do not assume any specific cloud file or structure from this skill's text or prior runs. Read what is actually there.

### 5. Read cloud's entry-point file(s) and central composing Kea logic in full

Identify them by looking at the scene's exported `SceneExport.component` and `SceneExport.logic`. Read both end-to-end so you know cloud's current shape before you change it. Read the shared `types.ts` for the cloud-side type definitions.

### 6. Skim the shared API wrappers

```sh
grep -n "signalReports\|signal_source\|signal_team\|signal_processing" /Users/twixes/Developer/posthog/frontend/src/lib/api.ts | head -30
```

Note which endpoints already have wrappers. The next sub-skill needs this to decide whether a feature can be ported (wrapper exists) or whether a wrapper needs adding (endpoint exists in backend but no TS wrapper yet) or whether it's a backend gap (endpoint doesn't exist; surface as open question).

### 7. Browse the upcoming-direction mocks (optional but recommended)

If the inbox is in active redesign, the mocks page at `https://posthog-self-driving.pages.dev` describes where things are heading. Open with Playwright (`browser_navigate`, `browser_snapshot`) and click through the tabs / configure-agents drawer to understand intent. This is **supplementary context for understanding the direction** — the actual desktop code is what you port. If the mocks page is unreachable, skip this step.

## Output

A brief inventory (kept in working memory) with:

- **Desktop files grouped by concern** — your derived groupings from this run, with file paths
- **Cloud files** — what's currently in `scenes/inbox/`, including any partial subdirectories from prior syncs
- **Shared API wrappers** — list of `api.signalReports.*` / `api.tasks.*` / etc. wrappers already in cloud
- **Missing wrappers but existing endpoints** — backend endpoints (from grep on `products/signals/backend/`) that lack a TS wrapper
- **Obvious feature mismatches noticed in passing** — quick gut-check list, **don't plan yet**; the next sub-skill does that
- **Notes on desktop's current IA** — whether it's still list+detail, has moved to tabs, has a drawer-based config, etc. This frames the planning step.

## Next step

**Do not stop here.** The parent `/sync-inbox-to-cloud` is a single uninterrupted workflow. Immediately invoke `/plan-inbox-sync` using the Skill tool. Do not summarize the inventory and wait, do not ask the user anything, do not pause — chain straight to the next step.
