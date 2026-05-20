# Operator Attribution on Hoglet Commits

## Problem

Every hedgemony hoglet runs in `pr_authorship_mode: "bot"` (hoglet-service.ts:268,
562, 663; raise-hoglet-handler.ts:72). That choice is intentional — visually
distinguishing autonomous-agent work from operator-direct work on GitHub — but
combined with the shared agent system prompt at
`packages/agent/src/server/agent-server.ts:1592-1609` it scrubs the operator
out of the record entirely:

- The system prompt bans `Co-Authored-By` trailers (defense against Claude
  Code's default attribution).
- Trailers emitted are only `Generated-By: PostHog Code` and `Task-Id: <uuid>`.
- The commit author is the posthog-code bot identity, not the operator.
- The PR author is the bot, not the operator.
- The `Task-Id` trailer is an internal posthog identifier — GitHub renders
  nothing for it.

Net: a hedgemony hoglet's PR shows up on GitHub with zero visible link to the
operator who initiated the run, and nothing credits their contribution graph.

Same behavior on `main` as on `hedgemony` — not a branch regression. But every
hedgemony hoglet trips it; normal user-mode tasks hide it because the commit
author IS the operator there.

## Solution: hedgemony-scoped operator co-author trailer

Add `Co-Authored-By: <operator-name> <operator-github-noreply-email>` to every
hoglet commit, sourced from a one-shot lookup at nest creation. Persist the
result on the nest row so subsequent hoglet spawns / raises don't re-fetch.
Inject the trailer instruction into the hoglet's user prompt as an explicit
override of the system prompt's no-Co-Authored-By rule.

Constraints honored:
- **Lookup stays local.** Renderer calls `posthogClient.getGithubLogin()`
  (already exists, returns `{ github_login: string | null }` from PostHog's
  `/api/users/@me/github_login/`). No credentials, no tokens, no GitHub-side
  calls leave the renderer.
- **Only the alias propagates.** The nest stores
  `operator_github_login` (string) and `operator_name` (display string from the
  PostHog user). The noreply email is constructed on demand — never persisted
  raw.
- **Zero changes to shared agent code.** `agent-server.ts` and
  `agent/service.ts` stay untouched. The override happens in the hoglet's user
  prompt, which the LLM follows when the instruction is explicit about why
  it's overriding the system rule.
- **Bot identity stays as commit/PR author.** The visual signal of autonomous
  work is preserved; the operator gets credit via the co-author trailer only.

## Noreply email format

GitHub credits the contribution graph for `Co-Authored-By` when the email
matches a verified email on the co-author's GitHub account. The privacy-
preserving way to do this without storing or surfacing the operator's real
email is GitHub's noreply form:

- Newer form (always works): `<numeric-id>+<login>@users.noreply.github.com`
- Older form (works when user has the noreply privacy setting enabled):
  `<login>@users.noreply.github.com`

The numeric ID isn't returned by `/api/users/@me/github_login/`. We have two
choices:

1. **Use the older form only.** `<login>@users.noreply.github.com`. Works for
   most users who have noreply enabled, won't credit the graph for users who
   don't. No backend extension needed.
2. **Extend the PostHog GitHub-integration endpoint to also return the
   numeric ID.** Then use the newer form unconditionally. Cleaner; requires a
   one-line backend addition.

Start with (1) — it works for the common case and requires zero coordination
with the posthog-cloud team. If users report graph credit not landing, swap
to (2).

## Changes

### 1. Nest schema — persist operator identity

**File:** `apps/code/src/main/db/schema.ts`

Add to `hedgemonyNests`:

```ts
operatorName: text("operator_name"),
operatorGithubLogin: text("operator_github_login"),
```

Both nullable so existing nests keep working. No backfill — nests created
before this change just won't get a co-author trailer on their hoglets, which
is the current behavior anyway.

### 2. Nest model — surface the fields

**File:** `apps/code/src/main/services/hedgemony/schemas.ts`

Extend `Nest` and `createNestInput` with:

```ts
operatorName: z.string().min(1).max(120).nullable().optional(),
operatorGithubLogin: z.string().min(1).max(40).nullable().optional(),
```

40-char ceiling on `operatorGithubLogin` matches GitHub's max login length.

### 3. Nest service — accept and persist

**File:** `apps/code/src/main/services/hedgemony/nest-service.ts`

`create()` already passes input fields through to the repository. Wire the
two new fields through. No validation beyond the schema cap — we trust the
renderer's lookup result.

### 4. Renderer — lookup at nest creation

**File:** wherever the operator submits a goal / triggers `nests.create`
(likely `apps/code/src/renderer/features/hedgemony/...` — find the
mutation call sites for the create-nest tRPC mutation).

Before calling the mutation:
- Read display name from auth state's `user` (`first_name + last_name`, or
  fall back to `email`'s local part).
- Call `posthogClient.getGithubLogin()`. Soft-fail: if null, skip the
  attribution fields entirely (nest gets created without operator
  identity — same as today's behavior).
- Pass `operatorName` and `operatorGithubLogin` into the mutation.

This is a one-shot lookup at nest creation. No need to cache, no need to
sync to main, no per-spawn API calls.

### 5. Spawn / raise prompt augmentation

**Files:**
- `apps/code/src/main/services/hedgemony/hedgehog-handlers/spawn-hoglet-handler.ts`
- `apps/code/src/main/services/hedgemony/hedgehog-handlers/raise-hoglet-handler.ts`
- (Probably also wherever the chat-bootstrap / spawn-follow-up paths
  construct prompts — audit `hoglet-service.ts` for prompt-building
  callsites.)

When building the prompt that goes to `cloudTaskClient.createTask` /
`createTaskRun`, append an attribution block constructed from the nest's
operator fields:

```ts
function buildOperatorAttributionBlock(nest: Nest): string {
  if (!nest.operatorName || !nest.operatorGithubLogin) return "";
  const noreplyEmail = `${nest.operatorGithubLogin}@users.noreply.github.com`;
  return `

## Operator attribution (hedgemony hoglet)
This hoglet was initiated by ${nest.operatorName} <${noreplyEmail}>. In
addition to the standard \`Generated-By\` and \`Task-Id\` trailers, add the
following trailer to every commit:

  Co-Authored-By: ${nest.operatorName} <${noreplyEmail}>

This is an explicit operator co-author trailer requested for this hoglet.
It is NOT the default Claude Code attribution that the system prompt asks
you to suppress — add this one alongside the standard trailers on every
commit you create.`;
}
```

Concatenate to the prompt body before sending to the cloud task. The
"NOT the default Claude Code attribution" clarifying sentence is what
resolves the conflict with the shared system prompt; LLMs follow explicit
user-prompt overrides when the override states its reason.

### 6. Tests

**Unit:**
- `nest-service.test.ts` — operator fields round-trip through `create()`.
- A new utility test for `buildOperatorAttributionBlock`:
  - returns empty string when either field is missing
  - constructs the noreply email correctly
  - includes the override clarifying sentence verbatim

**Integration (existing):**
- `spawn-hoglet-handler` and `raise-hoglet-handler` tests — assert the
  attribution block appears in the prompt sent to `cloudTaskClient` when
  the nest has operator fields, and is omitted when it doesn't.

No agent-side or cloud-side tests change. We can't verify the LLM
actually emits the trailer from a unit test; rely on spot-checking real
hoglet PRs after the change lands.

## Trade-offs vs. shared-code fix

- ✅ Zero risk to non-hedgemony tasks.
- ✅ Behavior gates with hedgemony itself.
- ✅ Operator identity lookup stays renderer-local; no credentials cross
  any boundary.
- ⚠️ Reliability depends on the LLM honoring an explicit user-prompt
  override of a system-prompt rule. Expected to work; occasional miss is
  possible. Mitigation: monitor a sample of hoglet PRs for the trailer; if
  miss rate is non-trivial, tighten the wording or lift the fix into the
  shared `buildCloudSystemPrompt`.
- ⚠️ Graph credit depends on the operator having the GitHub noreply
  privacy setting enabled. If not, the trailer still surfaces the
  operator's name on the commit (visible attribution) but won't credit
  the contribution graph. The numeric-ID upgrade fixes this if it
  becomes a real complaint.

## Out of scope

- A `Spawned-By-Hedgehog: nest-<id>` trailer signaling orchestrator
  provenance. Nice-to-have; punt until the basic Co-Authored-By is
  proven.
- Backfilling operator identity onto existing nests. Existing nests
  predate the change; future spawns from them won't get the trailer.
  Acceptable.
- Generalizing to non-hedgemony bot-mode tasks (if such cases emerge).
  At that point this should be lifted into the shared agent prompt.
- Numeric-ID lookup via GitHub or via PostHog backend extension. Wait
  until graph credit is an observed problem.

## Suggested commit boundaries

1. Schema migration + `Nest` model extension (no behavior change yet —
   just additive columns and types).
2. Renderer nest-creation augmentation (lookup + pass-through).
3. Prompt augmentation in spawn / raise handlers + tests.

Each commit is independently revertable.
