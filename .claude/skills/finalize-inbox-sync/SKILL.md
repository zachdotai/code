---
name: finalize-inbox-sync
description: Fifth step of the inbox-to-cloud sync workflow. Runs typecheck and format, runs any inbox-scene tests, and produces the structured final report the user verifies. Assumes `/simplify` has already run on the touched files (orchestrated by the parent skill). Use as part of `/sync-inbox-to-cloud`, or standalone after a hand-rolled sync followed by a manual simplify pass.
---

# Finalize the inbox sync

This is sub-skill 5 of `/sync-inbox-to-cloud`. Re-read the parent skill's hard rules at `/Users/twixes/Developer/code/.claude/skills/sync-inbox-to-cloud/SKILL.md` before starting.

## Goal

Verify the simplified sync compiles cleanly and emit the structured final report.

By the time this sub-skill is invoked, `/implement-inbox-sync` and `/simplify` have already run. The code is integrated and simplified; you just need to validate and report.

## Steps

### 1. Typecheck and format

Run from `~/Developer/posthog/`:

```sh
pnpm --filter=@posthog/frontend typescript:check
pnpm --filter=@posthog/frontend format
```

**Typecheck and format are not optional.** If typecheck takes 5+ minutes, run it anyway — kick it off in the background (`run_in_background: true` on the Bash call) and keep building the report in parallel. Do not report `not run` for typecheck or format under Verification. "Not run" is not an acceptable verification outcome — the user will run them locally and get a wall of errors that you could have surfaced.

If typecheck fails on a generated `*LogicType.ts`, the Kea type generator should regenerate it as part of the pipeline. If it still fails, follow `/Users/twixes/Developer/posthog/.claude/skills/writing-kea-logics/SKILL.md`.

If `/simplify` proposed deletions that broke a wire-up, fix it here before reporting.

**Do not** run the desktop typecheck (`pnpm typecheck` from the code repo) — you didn't touch that side.

### 2. Run any tests for the inbox scene

```sh
hogli test frontend/src/scenes/inbox
```

If tests fail because of behaviour changes in the port (e.g. the default `statusFilter` changed to match desktop), update the test expectations — desktop is the source of truth.

### 3. Produce the final report

This is the artifact the user verifies. Keep it skimmable — bullets, not paragraphs.

- **Synced** — features ported / polished, one bullet each, citing desktop source file → cloud destination file.
- **Stubbed (Coming soon™)** — desktop features intentionally disabled on cloud. Should contain ONLY live-chat affordances (Discuss / chat-with-inbox). If more than 1-2 items, you stubbed too aggressively — go back and revisit.
- **Reused existing cloud surface** — desktop features whose run-log viewing re-uses `products/tasks/frontend/`. The linkage itself belongs under "Synced", not here.
- **Skipped (rare)** — features with no cloud analogue (e.g. OS-only Electron API). More than a couple items means you skipped too much.
- **Open questions** — missing backend endpoints, UX ambiguities, sub-skill ambiguities for the next iteration. The user uses this to refine the skills.
- **Verification** — typecheck pass/fail, format pass/fail, simplify outcome, tests pass/fail-or-N/A. Cite commands and any error excerpts if anything failed.
- **Files modified** — final list of touched cloud files, for the user's diff review.

## Next step

**Do not stop here.** The parent `/sync-inbox-to-cloud` is a single uninterrupted workflow. Immediately invoke `/reflect-on-inbox-sync` using the Skill tool — it will audit the run against the hard rules and append concrete skill-refinement suggestions to your report. Do not finalize the output as "done" until reflection has appended its section.

Make the report accurate — if you skipped something for a reason not covered in the hard rules, say so under "Open questions" so the rules can be tightened next iteration.
