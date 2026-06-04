---
name: sync-inbox-to-cloud
description: Port every feature and UI polish from the PostHog Code desktop Inbox (Electron app) to the PostHog Cloud Inbox (Django + React). Orchestrates four sequential sub-skills — inspect, plan, implement, finalize — to re-inspect both surfaces from scratch on every run, then implement gaps on the cloud side using cloud conventions (LemonUI, Kea, scenes/urls/sceneTypes registration). Use when the user wants to bring the cloud Inbox to feature parity with desktop, after a change shipped to the desktop Inbox, or to audit/report drift between the two surfaces.
---

# Sync the PostHog Code Inbox to PostHog Cloud

## Mission

Bring the PostHog **Cloud** Inbox to feature parity with the PostHog **Code** desktop Inbox. The desktop Inbox is the **source of truth for product behaviour and UI polish**; cloud is the **target**.

You are syncing one direction: desktop → cloud. Do **not** touch the desktop repo.

**Scope includes the entire Inbox feature**, not just the report list/detail. Everything in `~/Developer/code/apps/code/src/renderer/features/inbox/` is in scope: the report list + detail, the configuration / management UI (sources, signal source toggles, team config), the autonomous-agent configuration UI (per-user autonomy, scout / responder management as those emerge), every adjacent affordance (banners, deep-link sync, engagement tracking, keyboard navigation, dismiss flows). If it lives under `features/inbox/` on desktop, it gets ported.

The two surfaces share the same backend (`SignalReport` API + signal source / config / processing endpoints, all under `products/signals/backend/` on cloud, exposed via `api.signalReports` and friends in `frontend/src/lib/api.ts`). They differ only in how the UI is built. Your job is to translate behaviour and polish, not the underlying data shapes.

## Hard rules

These are binding across **all four sub-skills**. Re-read them at the start of each sub-skill.

- **Both Inbox surfaces are moving targets — this skill must NOT hard-code today's structure.** The desktop Inbox is mid-evolution (e.g. the user is moving from a single signal report list toward a tabbed Pull-requests / Reports / Agents IA, with a chat-with-inbox affordance and a drawer-based "Configure agents" surface). Cloud lags behind. Re-derive structure on each run by `ls`/`find` on both sides; do not assume any specific file, tab, component name, or layout from this skill's text. Forward-looking direction is available at the mocks page (`https://posthog-self-driving.pages.dev`, browse with Playwright if helpful) but **only the actual desktop code is the source of truth**.

- **Inspect the desktop Inbox today, every run.** Do not rely on a prior snapshot — list every file under the desktop Inbox dir and read the ones relevant to each feature. The desktop Inbox is the moving target.

- **Cloud uses LemonUI (`@posthog/lemon-ui` + `lib/lemon-ui/*`). Never import `@radix-ui/themes`, `@posthog/quill`, `@phosphor-icons/react`, or `lucide-react` in cloud files.** Translate every desktop component to its Lemon equivalent. Icons come from `@posthog/icons`.

- **Cloud uses Kea for state, not Zustand or TanStack Query.** Every store/hook on the desktop side maps to a Kea logic on the cloud side. Follow `~/Developer/posthog/.claude/skills/writing-kea-logics/SKILL.md` and `using-kea-disposables/SKILL.md`. Logic file naming: `<feature>Logic.ts` with auto-generated `<feature>LogicType.ts`.

- **Live agent chat is the ONLY thing that gets stubbed to "Coming soon™".** Cloud cannot host a real-time agent chat surface yet — a true chat-with-inbox affordance (streaming responses, message bubbles, in-app conversation thread) renders as a disabled control with "Coming soon™" on cloud. **Task-kickoff actions are NOT live chat.** If desktop's "Discuss" (or any "chat with inbox" affordance) creates a task via `taskService.createTask` and navigates away, port it — it's NOT live chat, regardless of what the button says. Anything that just creates a task and walks away — "Create PR", "Discuss", research kickoff, repo selection prompts — must be fully ported, including prompt construction. Cloud has the same task-creation capability (`api.tasks.*` + `~/Developer/posthog/products/tasks/`); use it. Only stub when the desktop surface holds an in-app conversation (streaming responses, message bubbles, etc.) — grep the desktop file for `taskService.createTask` or equivalent before deciding to stub.

- **SignalReport ↔ Task linkage is required, not optional.** Wherever desktop links a SignalReport to its tasks, cloud must show the same affordance — render the task list / latest task status inline in the detail surface, and **link** users out to cloud's existing task UI (`products/tasks/frontend/TaskDetailPage.tsx`, `TaskSessionView.tsx`) for the actual run-log viewing. Do not rebuild that row-view run-log UI on cloud. If the API wrapper doesn't exist on cloud, add the wrapper — the backend endpoint exists (`SignalReportTaskViewSet` in `products/signals/backend/views.py`). Adding a frontend wrapper on top of an existing backend endpoint is fair game; adding a new backend endpoint is not.

- **Port every UI aspect. No "follow-up PR" escape hatch.** Every filter, default value, empty state, keyboard shortcut, polish detail desktop has — all of it. If porting requires a structural rewrite of the cloud scene (changing the layout shape, splitting the scene file, adding new top-level tabs or drawers), do the rewrite. The cloud scene can grow, get split into subcomponents, get re-IA'd to match desktop's current IA, or be reorganized end-to-end. The ONLY legitimate reason to not fully port a thing is the live-chat rule above. "Skip" is not a routine decision; "deferred to follow-up" is not a category.

- **Desktop is the source of truth for UI/UX behavior, defaults, copy, ordering, and persistence.** When cloud and desktop disagree on a default (e.g. cloud's `statusFilter` defaults to `[READY]` but desktop's defaults to all six in-flight statuses), change cloud to match desktop. Same for sort field / sort direction, filter persistence keys, label strings, empty-state copy, refresh intervals — match desktop exactly unless a cloud-specific constraint physically prevents it.

- **The backend is the source of truth for data shape and enum values.** For UI/UX, desktop wins (rule above). For "does this enum value actually exist?" type questions, grep `~/Developer/posthog/products/signals/backend/{models,serializers,views}.py` and trust what the Django models / serializers say. If desktop and cloud disagree on a status enum value, follow the backend and remove whichever side is stale.

- **Don't touch desktop code.** Read-only on the `~/Developer/code` side. One-way sync.

- **Don't modify the Python backend in `products/signals/backend/`** — no new endpoints, no serializer field changes, no migrations. If a desktop feature genuinely needs a new backend endpoint, surface it under "Open questions" and skip just that piece. However, **adding a TS wrapper in `frontend/src/lib/api.ts` on top of an existing backend endpoint is expected and required** — that's not a backend change. Grep `products/signals/backend/views.py` and `routes.py` to confirm endpoints exist before deciding one is missing.

- **No new feature flags unless desktop has one.** If desktop gates a feature behind a flag (e.g. `INBOX_GATED_DUE_TO_SCALE_FLAG`), mirror the gate on cloud using `useFeatureFlag` from `lib/hooks/useFeatureFlag`. Otherwise ship ungated.

- **Mirror desktop's organization, adapted to cloud conventions — derive fresh each run.** Whatever subdirectories and component splits desktop uses today, replicate the analogous shape on cloud. Components matter most: every named component on desktop gets a same-named component on cloud (translated to LemonUI). Layer cloud's own conventions on top: PascalCase component files, generated `*LogicType.ts` next to each Kea logic. Do not dump everything into one giant scene file. If desktop has reorganized since the last sync, cloud follows.

- **Polish parity is part of the port, not a "nice-to-have".** Every visual / interaction detail: search bar position and orientation, toolbar layout, sticky headers, hover states, badge variants, skeleton shapes, empty-state hedgehogs, responsive breakpoints, sidebar widths, scroll behaviour, keyboard focus rings. Match the look and feel within the constraint that cloud uses LemonUI. When LemonUI has no exact match (e.g. a specific animated loader, a specific badge variant), implement it in plain JSX + Tailwind in the cloud Inbox dir. Do not add a third component library.

- **Missing dependencies don't license skipping polish.** If cloud lacks a desktop dependency (`framer-motion`, `tiptap`, etc.), pick one of: (a) add the dep to cloud's `frontend/package.json` if it's small and well-maintained; (b) port the visual using cloud-available substitutes (CSS transitions, `react-transition-group`, `Motion One`, plain `<video>` instead of an animated wrapper); (c) keep the visual off but surface it explicitly under Open Questions in the final report. Replacing a `<motion.div>` with a bare `<div>` and reporting "no functional impact" is a polish drop. Animations, fan stacks, springy reorders are part of the desktop UX — they don't get silently dropped.

## Workflow — single uninterrupted pass

This skill is a six-step workflow. **Run it as one continuous pass.** Do not stop between steps. Do not produce intermediate summaries and wait. Do not ask the user for confirmation between steps. The only output the user sees is the final structured report from step 5, with self-reflection appended in step 6.

Invoke each sub-skill in order using the Skill tool:

1. **`/inspect-inbox-surfaces`** — list both repos, read entry-point files, produce an inventory.
2. **`/plan-inbox-sync`** — diff the inventories, produce a sync manifest, design slicing for parallel sub-agents.
3. **`/implement-inbox-sync`** — execute the manifest with parallel sub-agents; orchestrator integrates the central scene file and central logic.
4. **`/simplify`** — invoke the existing simplify skill on the touched cloud files to strip redundant abstractions left behind by parallel work.
5. **`/finalize-inbox-sync`** — typecheck, format, run inbox tests, produce the final structured report.
6. **`/reflect-on-inbox-sync`** — audit the run against the hard rules, surface any violations, and propose concrete skill-refinement suggestions for the next iteration.

Each sub-skill ends with an explicit "now invoke the next skill" instruction. Honor it — do not pause at the boundary.

Each sub-skill is also independently invocable for partial work (e.g. re-running just `/plan-inbox-sync` to refresh a manifest after desktop reorganized), but the default flow when the parent skill is invoked is the full six-step pass.

## Final report format

The final report comes out of `finalize-inbox-sync`. It is the artifact the user verifies. Keep it skimmable — bullets, not paragraphs.

- **Synced** — features ported / polished, one bullet each, citing desktop source → cloud destination.
- **Stubbed (Coming soon™)** — desktop features intentionally disabled on cloud. Should contain ONLY live-chat affordances. If more than 1-2 items, you stubbed too aggressively — re-examine.
- **Reused existing cloud surface** — features whose run-log viewing re-uses cloud's task surface, with the cloud path. The linkage itself belongs under "Synced".
- **Skipped (rare)** — features with no cloud analogue (e.g. OS-only Electron API). More than a couple items means you skipped too much.
- **Open questions** — missing backend endpoints, UX ambiguities, sub-skill ambiguities for the next iteration.
- **Verification** — typecheck / format / simplify / tests pass-or-fail status.

## References

- `references/parallelization.md` — slicing patterns for parallel sub-agents, used by `plan-inbox-sync` and `implement-inbox-sync`.

## Anti-checklist (things that mean you went wrong)

- You imported `@radix-ui/themes` or `@posthog/quill` in a cloud file → revert.
- You added `zustand` to the cloud `package.json` → revert.
- You wrote a cloud component that does `useEffect(() => fetch(...))` for domain data → move it to a Kea `loaders` builder.
- You introduced a "Discuss" panel that actually opens a chat → stub it.
- You re-implemented the run-log row-view UI on cloud → reuse `products/tasks/frontend/TaskDetailPage.tsx` / `TaskSessionView.tsx` (but still wire the inbox-side linkage).
- You **skipped** a desktop feature because porting was "structural" or "out of scope" → port it. No scope escape hatch except live chat.
- You **stubbed Coming soon™** on a feature that just kicks off a task → revert; wire it to `api.tasks.*`.
- You left cloud defaults different from desktop defaults → revert; match desktop.
- You kept a cloud filter in memory while desktop persists it → add `{ persist: true }` to the Kea reducer.
- You guessed whether a status enum value belongs → grep `products/signals/backend/{models,serializers,views}.py` and follow the backend.
- You touched files under `~/Developer/code/` → revert.
- You added a backend endpoint, serializer field, or migration → stop and surface as an open question. (Adding a frontend wrapper in `lib/api.ts` over an existing endpoint is fine.)
- You added a feature flag that doesn't exist on desktop → revert.
