# Repo Slug Validation & Self-Healing

## Problem

When nests are created, `extractRepoReferences()` extracts repo slugs from the
operator's transcript via regex. A slightly wrong name (e.g. `nexus-game` vs
`nexus-games`) becomes the nest's `primaryRepository` and every hoglet spawned
against it fails at clone time with no recovery path.

Root cause chain:
1. `extractRepoReferences` (goal-spec-draft-service.ts:636) does pure regex —
   no GitHub validation
2. `buildBootstrapContext` (goal-spec-draft-service.ts:591) sets
   `primaryRepository = repositories[0]`
3. `NestService.create` (nest-service.ts:61-64) stores it permanently on the nest
4. `deriveRepositoryContext` reads it every tick and puts it in `known_repositories`
5. Hedgehog spawns hoglets against it → cloud clone fails

There is also a propagation bug: `hogletService.spawnFollowUp` (hoglet-service.ts:638)
blindly copies `parent.task.repository` when spawning follow-up hoglets. If the
parent had the wrong repo (e.g. because `message_hoglet` on a terminated session
triggered a follow-up), the follow-up inherits the wrong repo too — even if the
nest's `primaryRepository` has since been corrected.

## Solution: Three-layer validation

### Layer 1 — Proactive auto-correction at nest creation

In `NestService.create()`, after resolving `primaryRepository` from the bootstrap
context, validate it against the operator's GitHub integrations. If it doesn't
match, fuzzy-match against accessible repos and auto-correct if there's a
confident single match (same owner, edit distance ≤ 2). Write an audit message
so the operator sees what happened.

### Layer 2 — Defensive suggestions at spawn time

In `spawn-hoglet-handler.ts`, before calling `spawnInNest`, validate the
resolved repo via `resolveGithubUserIntegration`. If null, compute fuzzy
suggestions and return failure with those suggestions in the scratchpad summary.
The hedgehog sees the suggestions and retries with the correct slug. The
operator sees an audit message in nest chat.

### Layer 3 — Follow-up hoglets use the nest's repo, not the parent's

In `hogletService.spawnFollowUp`, when the follow-up is for a nest hoglet,
prefer the nest's current `primaryRepository` over the parent task's stale
`repository` field. Also validate the chosen repo via
`resolveGithubUserIntegration` (like `spawnInNest` already does) instead of
blindly copying the parent's integration fields.

## Changes

### 1. New utility: `repo-slug-match.ts`

**File:** `apps/code/src/main/services/hedgemony/repo-slug-match.ts` (NEW)

Three functions:

- `levenshteinDistance(a, b)` — case-insensitive Wagner-Fischer single-row DP
- `findSimilarRepoSlugs(target, candidates, maxDistance=3)` — returns candidates
  within edit distance, sorted by distance
- `findConfidentMatch(target, candidates)` — returns a single match only when
  same owner + repo edit distance ≤ 2 + unique. Returns null if ambiguous.

Unit tests in `repo-slug-match.test.ts` alongside.

### 2. `CloudTaskClient` — expose accessible repo list

**File:** `apps/code/src/main/services/hedgemony/cloud-task-client.ts` (~line 473)

Add `listAccessibleRepositorySlugs(): Promise<string[]>`:
- Warms the existing 5-min integration cache via
  `resolveGithubUserIntegration("__cache_warmup__")`
- Returns `[...this.repoIntegrationCache.map.keys()]`
- Returns `[]` on API failure (soft-fail)

### 3. `UpdateNestData` — allow `primaryRepository` updates

**File:** `apps/code/src/main/db/repositories/nest-repository.ts` (line 26-34)

Add `primaryRepository?: string | null` to `UpdateNestData`. The existing
`update()` already spreads `data` into Drizzle `set()`, so this just works.

### 4. `NestService.create` — validate & auto-correct

**File:** `apps/code/src/main/services/hedgemony/nest-service.ts`

- Inject `CloudTaskClient` via `@inject(MAIN_TOKENS.CloudTaskClient)`
- Add private `validateAndCorrectRepository(slug)`:
  - `resolveGithubUserIntegration(slug)` → if found, return unchanged
  - If null → `listAccessibleRepositorySlugs()` + `findConfidentMatch()`
  - If confident match → return corrected. Otherwise return original.
  - Catches all errors — never blocks creation on API failure
- In `create()`: change `const` → `let` for `primaryRepository`, call
  validation, write audit message if corrected:
  ```
  Auto-corrected primary repository: "Brooker-Fam/nexus-game" →
  "Brooker-Fam/nexus-games" (original slug not found in GitHub integrations).
  ```

### 5. `spawn-hoglet-handler` — defensive validation

**File:** `apps/code/src/main/services/hedgemony/hedgehog-handlers/spawn-hoglet-handler.ts`

After repo resolution (~line 96) and before `spawnInNest` (~line 98):
- `resolveGithubUserIntegration(repository)` → if null:
  - `listAccessibleRepositorySlugs()` + `findSimilarRepoSlugs()`
  - Write audit: `Repository "X" is not accessible. Did you mean: Y?`
  - Return `{ success: false }` with suggestions in scratchpadSummary
- On API error: log warning, proceed anyway (graceful degradation)

### 6. Hedgehog prompt — teach retry

**File:** `apps/code/src/main/services/hedgemony/hedgehog-prompts.ts` (~line 58)

Add to hard constraints:
```
- If spawn_hoglet fails because the repository is "not accessible" and the
  error includes suggestions, retry with the suggested slug. If multiple are
  listed, pick the one that best matches the nest's goal.
```

### 7. `spawnFollowUp` — prefer nest repo over parent repo

**File:** `apps/code/src/main/services/hedgemony/hoglet-service.ts` (line 619-697)

Currently line 638 blindly copies the parent's repo:
```typescript
repository: parent.task.repository ?? null,
```

Change to:
- Accept the nest's current `primaryRepository` (look up via `nestId` from
  `input`)
- Use: `nestPrimaryRepository ?? parent.task.repository ?? null`
- Re-resolve `githubUserIntegration` for the chosen repo (like `spawnInNest`
  does at line 454) instead of copying stale `github_integration` /
  `github_user_integration` from the parent

This ensures follow-up hoglets get the corrected repo when the nest's primary
has been auto-fixed, and they get a fresh integration ID.

### 8. Test updates

**File:** `apps/code/src/main/services/hedgemony/nest-service.test.ts`

- Add `CloudTaskClient` mock as 6th constructor arg
- Tests: auto-corrects on fuzzy match, leaves valid slug unchanged, no-op on
  API failure, no-op when primaryRepository is null

## Implementation order

1. `repo-slug-match.ts` + tests (pure utility, no deps)
2. `cloud-task-client.ts` (add `listAccessibleRepositorySlugs`)
3. `nest-repository.ts` (one-line interface change)
4. `nest-service.ts` (inject CloudTaskClient, add validation)
5. `spawn-hoglet-handler.ts` (defensive validation)
6. `hoglet-service.ts` (follow-up repo preference + re-resolve integration)
7. `hedgehog-prompts.ts` (prompt update)
8. `nest-service.test.ts` (update constructor, add test cases)

## Verification

1. `pnpm typecheck` — catches import/type errors
2. `pnpm --filter code test` — runs unit tests
3. Manual: create a nest with a slightly-wrong repo name → audit message shows
   correction
4. Manual: force a spawn with a wrong repo → suggestions appear in nest chat

## Key files reference

| Component                  | File                                              | Lines   |
|----------------------------|---------------------------------------------------|---------|
| Repo extraction (regex)    | `goal-spec-draft-service.ts`                      | 636-667 |
| Bootstrap context build    | `goal-spec-draft-service.ts`                      | 583-634 |
| Nest creation              | `nest-service.ts`                                 | 59-90   |
| Nest DB update             | `nest-repository.ts`                              | 87-98   |
| Spawn handler              | `spawn-hoglet-handler.ts`                         | 15-149  |
| Hoglet cloud spawn         | `hoglet-service.ts`                               | 445-516 |
| Follow-up spawn (bug)      | `hoglet-service.ts`                               | 619-697 |
| Follow-up callers          | `useHedgemonyPromptRouter.ts`, `useHedgemonyPrGraphRouter.ts` | —  |
| GitHub integration resolve | `cloud-task-client.ts`                            | 402-473 |
| Repo context derivation    | `hedgehog-tick-service.ts`                        | 545-622 |
| Handler deps type          | `hedgehog-handlers/types.ts`                      | 41-47   |
| Repo slug schema           | `schemas.ts`                                      | 8-15    |
