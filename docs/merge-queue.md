# Merge queue

PRs merge into `main` **exclusively** through the [Trunk](https://trunk.io) merge queue. The GitHub merge button and `gh pr merge` are blocked by branch rulesets — the queue is the only way in.

## How to merge a PR

1. Get the PR green: required checks passing (pending is fine — the queue waits), reviews approved, no conflicts.
2. Enqueue it by commenting on the PR:

   ```
   /trunk merge
   ```

   (or apply the `trunk-merge-queue-submit` label). The queue tests your change merged on top of everything ahead of it, then merges it when the batch is green.

3. Watch the **`Trunk Merge Queue (main)`** check run on the PR's head commit. It moves through `queued` → `in_progress` → `completed`.

To pull a PR back out of the queue, comment `/trunk cancel` (or remove the label).

### When a queued PR fails

If the batch fails, Trunk kicks the PR out of the queue and the Trunk bot leaves a comment linking the workflows that failed. Fix the failure, push, and re-enqueue with `/trunk merge`.

Do **not** force-push a branch while it is in the queue — that removes it from the queue.

## Enqueue from the command line

```bash
gh pr comment <number> --body "/trunk merge"    # enqueue
gh pr comment <number> --body "/trunk cancel"   # cancel
```

Check the queue status without leaving the terminal:

```bash
gh api repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/commits/$(gh pr view <number> --json headRefOid -q .headRefOid)/check-runs \
  --jq '.check_runs[] | select(.name | startswith("Trunk Merge Queue")) | {status, conclusion, details_url}'
```

Agents working in PostHog Code follow the [`merging-prs` skill](../.claude/skills/merging-prs/SKILL.md), which enqueues a PR and babysits it until it merges or fails.

---

## Admin setup (one-time)

Configuring the queue requires repo admin on GitHub **and** org admin in the Trunk dashboard. This section records the exact settings so the enforcement can be reproduced or audited.

### 1. Trunk dashboard

At [app.trunk.io](https://app.trunk.io) → this repo → **Merge Queue**:

- Enable the merge queue targeting `main`.
- Keep **draft-PR mode** (the default): Trunk opens a same-repo draft PR containing each queued batch, so the existing `pull_request`-triggered workflows run against it unchanged. No `.github/workflows/` edits are needed.
- Enable **GitHub comment commands** (`/trunk merge`, `/trunk cancel`).
- Enable the enqueue label (default name `trunk-merge-queue-submit`).

### 2. GitHub Ruleset — "Merge queue enforcement"

Bypass permissions apply to a whole ruleset, so enforcement is split across two rulesets. Create a ruleset on `main` with:

- Rule: **Restrict updates** — blocks direct pushes and the merge button for everyone.
- Bypass list: the **`trunk-io` GitHub App**, mode **`Exempt`**.
  - It must be `Exempt`, **not** the default `Always`. `Always` does not cover branch updates made by a GitHub App, so merges fail with a permissions error.

### 3. GitHub Ruleset — "PR requirements"

A second ruleset on `main`, with the `trunk-io` app **not** on the bypass list (the queue relies on GitHub reporting the PR as "not ready" until these pass):

- Required status checks: `build`, `quality`, `unit-test`, `integration-test`, `typecheck`, `e2e`.
  - `e2e` reports `skipped` when a batch touches no `packages/**` files, which still satisfies a required check. It is a live-model test — if its flakiness starts kicking otherwise-green batches out of the queue, drop it from this list (one ruleset toggle, no code change).
- Required reviews and conversation resolution as currently configured.

### 4. Exclude Trunk's working branches

Trunk creates and deletes `trunk-temp/**` and `trunk-merge/**` branches while testing batches. Add these exclude patterns (the trailing `/*` is required for GitHub's matcher) to **any** ruleset or classic branch protection whose pattern would otherwise match them:

```
trunk-temp/**/*
trunk-merge/**/*
```

Otherwise Trunk fails with "permission denied" on its own branches.

### 5. Repo settings

- Leave at least one merge method enabled — Trunk merges through the GitHub API, and the "Merge queue enforcement" ruleset already blocks humans.
- If GitHub's native merge queue ("Require merge queue") was ever enabled on `main`, turn it off. Only one merge-queue tool can run at a time.

### 6. Smoke test

1. Open a trivial PR, comment `/trunk merge`, and confirm the `Trunk Merge Queue (main)` check run appears on the head commit and the PR merges.
2. On a second PR, confirm `gh pr merge` (and the merge button) are rejected.
3. Record the exact check-run name observed — the app's merge-queue integration matches it by the `Trunk Merge Queue` prefix.
