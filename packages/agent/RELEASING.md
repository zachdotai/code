# Releasing @posthog/agent

`@posthog/agent` is the only npm-published package in this repo. It ships to
PostHog cloud sandboxes, so releases are intentional and human-approved,
following the [PostHog SDK release process](https://posthog.com/handbook/engineering/sdks/releases).
There is no auto-publish on merge.

## When to add a changeset

Add a changeset in any PR whose changes should ship to npm:

- Changes under `packages/agent`.
- Changes under `packages/shared`, `packages/git` or `packages/enricher` that
  affect the agent. These packages never publish on their own; tsup bundles
  them into `@posthog/agent`, so they only reach npm through an agent release.

Always target `@posthog/agent` in the changeset. The other packages are
private and cannot be versioned.

```bash
pnpm changeset
```

Pick a bump (patch/minor/major) and write a summary; it becomes the
`packages/agent/CHANGELOG.md` entry and the GitHub release notes. PRs without
a changeset merge normally and release nothing.

## What happens after merge

Merging a changeset to `main` triggers `.github/workflows/agent-release.yml`:

1. `prepare-release-candidate` runs `changeset version`, asserts that only
   `packages/agent/package.json`, `packages/agent/CHANGELOG.md` and consumed
   `.changeset/*.md` files changed, and uploads the diff as a sha256-pinned
   patch artifact.
2. `verify-release-candidate` re-applies the patch on a clean checkout, checks
   the version is consistent and not already tagged, released or published,
   then builds and tests the exact candidate.
3. Slack pings the approvals channel with a compare link against the previous
   `agent-v*` tag.
4. The `release` job waits for approval on the protected `Release`
   environment. Reviewers approve or reject from the workflow run page.
5. After approval, the job re-verifies the patch hash and that `main` has not
   moved, commits the version bump via the release GitHub App (signed API
   commit, `[skip ci]`), creates the `agent-v<version>` tag, rebuilds, tests,
   publishes to npm with OIDC provenance and creates the GitHub release.

Several changesets merged before the run starts batch into one release. Runs
queue behind each other (`concurrency: agent-release`); each queued release
needs its own approval.

## Approving or rejecting

Required reviewers are configured on the `Release` environment (repo Settings
-> Environments). Review the Slack compare link and the green verify build,
then approve or reject on the run's review prompt. A rejection blocks the
release job before it starts: nothing is committed, tagged or published, and
the Slack thread is updated with the rejection comment.

## Failures and re-runs

The release job is idempotent; every side effect is preceded by an existence
check:

- Publish failed after the version bump commit landed: `main` says version X,
  npm does not have it. Re-run the release job (or dispatch the workflow). It
  detects the existing `agent-v<version>` tag, skips commit and tag creation
  and retries build, test, publish and the GitHub release.
- "main moved since the release candidate was verified": an unrelated commit
  landed between verification and approval. Re-run the whole workflow
  (`workflow_dispatch` on the Actions page) so a fresh candidate is prepared
  against the new `main`.
- Already-published versions are never re-published; the publish step is
  skipped when npm already has the version.

Version reporting: source builds (dev, desktop, vitest) report the sentinel
`0.0.0-dev`, which the UI treats as "latest, satisfies any feature gate"
(`packages/ui/src/utils/agentVersion.ts`). Only the release workflow builds
with `AGENT_RELEASE_BUILD=1`, which makes tsup inject the real version from
`packages/agent/package.json` (see `packages/agent/src/version.ts`).

## Operational setup

The pipeline depends on GitHub and npm settings that live outside this repo's
code. If any of these drift, releases fail closed:

- `Release` environment: required reviewers, prevent self-review on, admin
  bypass off, deployments restricted to `main`.
- GitHub App (`GH_APP_POSTHOG_AGENT_RELEASER_*` secrets, scoped to the
  `Release` environment): Contents read/write on this repo only. Bypasses the
  `agent-v*` tag ruleset and CodeQL/PR rulesets.
- Tag ruleset for `agent-v*`: create, update and delete restricted to the App.
- npm trusted publisher for `@posthog/agent`: org `PostHog` (case-sensitive),
  workflow `agent-release.yml`, environment `Release` (exact case). No npm
  token exists; publishing uses OIDC with provenance.
- Slack: org secret `SLACK_CLIENT_LIBRARIES_BOT_TOKEN` and
  `POSTHOG_PROJECT_API_KEY` granted to this repo, plus repo vars
  `SLACK_APPROVALS_CODE_CHANNEL_ID` and `GROUP_CODE_SLACK_GROUP_ID`. Slack
  failures never block a release; the environment approval is the gate.
