---
name: reflect-on-inbox-sync
description: Final step of `/sync-inbox-to-cloud`. Audits the just-completed sync against the parent skill's hard rules and anti-checklist, surfaces violations or near-misses, and proposes concrete skill-refinement suggestions for the next iteration. Use only as the closing step of `/sync-inbox-to-cloud` — not standalone.
---

# Reflect on the inbox sync

This is sub-skill 6 of `/sync-inbox-to-cloud` — the last step. By the time you're invoked, the work is complete, `/simplify` has run, and `/finalize-inbox-sync` has produced the structured final report.

## Goal

Audit the run against the parent skill's hard rules, surface anything that drifted from the intent, and produce concrete edits the user could apply to the skill text to prevent the same drift next time.

The user iterates on these skills by running them, inspecting the output, and refining the text. **Your job is to make that iteration loop tight** — point at specific rule gaps and propose specific text changes, not vague critique.

## Steps

### 1. Re-read the rules

Re-read in full:

- `/Users/twixes/Developer/code/.claude/skills/sync-inbox-to-cloud/SKILL.md` — the Hard rules section and the Anti-checklist section
- The translation reference at `/Users/twixes/Developer/code/.claude/skills/implement-inbox-sync/references/translation.md`
- The parallelization reference at `/Users/twixes/Developer/code/.claude/skills/sync-inbox-to-cloud/references/parallelization.md`

You're auditing against these rules. Hold them in mind as you work through the next steps.

### 2. Walk the final report against the rules

Take the report `/finalize-inbox-sync` just produced. For each section:

- **Synced** — is there evidence the polish-parity rule was honored, or did the item only port the feature and skip the polish? Cross-reference desktop's component file against the cloud destination — did the cloud component have an analogous shape?
- **Stubbed (Coming soon™)** — is every stubbed item genuinely a live-chat affordance? If anything else was stubbed, that's a violation of the live-chat-only rule. Flag it.
- **Reused existing cloud surface** — is the linkage itself ported (so it appears under Synced), or did this entry sneak in to cover for not building the linkage? Flag if the linkage is missing.
- **Skipped (rare)** — for each skipped item, is there genuinely no cloud analogue? If you can think of a way to port it, that's a "no scope escape hatch" violation. Flag it.
- **Open questions** — were any of these things that the skill should have answered? If a sub-skill produced ambiguity that the agent had to escalate, the skill text is unclear. Flag the section that needs tightening.

### 3. Audit for things missing from the report

Pull up the inventory `/inspect-inbox-surfaces` produced (or re-list the desktop Inbox dir if the inventory isn't in working memory). Cross-reference every desktop feature against the report. Anything in the inventory that doesn't appear under Synced / Stubbed / Reused / Skipped is **silently dropped** — that's the worst failure mode. Flag each.

### 4. Audit the actual diff

Don't trust the report alone — verify against the code. Run from `~/Developer/posthog/`:

```sh
git status
git diff --stat
```

Then spot-check for hard-rule violations:

```sh
# Forbidden imports in cloud Inbox files
grep -rn "@radix-ui/themes\|@posthog/quill\|@phosphor-icons/react\|lucide-react" frontend/src/scenes/inbox/ products/signals/frontend/ 2>/dev/null

# Forbidden new files on the desktop side
git -C /Users/twixes/Developer/code status 2>/dev/null | head

# Forbidden backend changes
git diff --name-only products/signals/backend/

# Forbidden new feature flags
git diff frontend/src/lib/constants.tsx | grep -i "FLAG"
```

Each non-empty result is a possible violation — investigate before flagging.

### 5. Audit for Kea persistence parity

If the manifest included filter / sort / sidebar state, check that anything desktop persists via Zustand `persist()` is mirrored on cloud with Kea `{ persist: true }`:

```sh
# Cloud reducers that persist
grep -rn "persist: true" frontend/src/scenes/inbox/

# Desktop stores that persist
grep -rn "persist(" /Users/twixes/Developer/code/apps/code/src/renderer/features/inbox/stores/
```

Compare. Any state desktop persists that cloud doesn't is a parity violation.

### 6. Generate refinement suggestions

For each issue found in steps 2-5, propose a concrete skill text change. Each suggestion specifies:

- **Which file** — parent SKILL.md, which sub-skill SKILL.md, or which reference doc
- **Which section** — the heading or rule it lives under
- **What change** — the specific text edit or addition

Even if no violations were found, propose at least one refinement if you noticed any ambiguity during the run — e.g. a rule that required interpretation, a hand-off that wasn't crisp, a slice boundary that produced merge friction.

If you really cannot find anything to refine, say so honestly — but the bar for "perfect" is high. The first dozen runs of this skill should produce refinement suggestions every time.

## Output

Append two sections to the final report that `/finalize-inbox-sync` produced:

- **Self-reflection** — bullets. One per finding from steps 2-5 above. Mark each as `[compliant]`, `[possible violation]`, or `[silently dropped]` with a brief explanation and citation (file path / report section).
- **Suggested skill refinements** — bullets. One per concrete edit. Format: "In `<file>` under `<section>`: <specific text change>." Keep each suggestion tight enough that the user can apply it without re-deriving the reasoning.

## Do not

- **Do not modify the skill files yourself.** Only propose changes. The user decides which to apply.
- **Do not flatter.** "Everything looks great" with no findings is suspicious — re-audit.
- **Do not invoke any other sub-skills after this.** This is the end of the workflow. After your output is appended, the run is complete.
