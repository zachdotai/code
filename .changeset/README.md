# Changesets

This folder drives releases of `@posthog/agent`, the only npm-published package
in this repo. A merged changeset triggers the release pipeline in
`.github/workflows/agent-release.yml`, which prepares and verifies a release
candidate and then waits for human approval before publishing.

To request a release, run `pnpm changeset` at the repo root, select
`@posthog/agent`, pick a semver bump and describe the change. Changes to
`packages/shared`, `packages/git` or `packages/enricher` also ship through
`@posthog/agent` (they are bundled into it), so changesets for those changes
must target `@posthog/agent` too.

See `packages/agent/RELEASING.md` for the full release process and
[changesets docs](https://github.com/changesets/changesets) for the format.
