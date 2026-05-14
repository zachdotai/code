# FinOps for Hedgemony

## Context

Hedgemony spawns Claude agents (hedgehogs in nests, brood hoglets, wild hoglets) and runs hedgehog "ticks" via LlmGateway. Today, per-turn token counts and the SDK's `total_cost_usd` flow through the agent layer but are **never persisted, aggregated, or visible**. A nest could spawn hoglets for days with no way to know what it cost. There is no enforcement to stop a misbehaving hedgehog from burning unbounded spend.

V1 covers all four goals: **observability + PostHog telemetry + enforcement + cost-aware orchestration**, with a **hybrid cost source** (SDK `total_cost_usd` when present, pricing-table fallback for Codex), **hybrid persistence** (event log + denormalized totals), and **full agent scope** (hedgehog ticks, brood hoglets, wild hoglets).

Delivered in five sequential phases (A → E) so each phase ships value on its own.

---

## Precedents and alignment

This work follows two existing PostHog precedents and aligns with both.

### The FinOps tagging RFC (`engineering/2026-05-06-finops-tagging-standard.md`)

PostHog has a published FinOps tagging standard for cloud infra and Kubernetes workloads. It defines a tag schema we mirror at the application layer so hedgemony spend lands in DoiT-style allocations using the same dimensions as the rest of the company.

| Tag | Value for hedgemony | Notes |
|---|---|---|
| `team` | `posthog-code` | The team accountable for hedgemony |
| `product` | `hedgemony` | New dimension; aligns with LLM Gateway's per-product convention |
| `environment` | `dev` \| `prod-us` \| `prod-eu` | Inferred from cloud region / dev build |
| `system` | `hedgemony` | Narrower-than-product; we own the system |
| `workload` | `hedgehog-tick` \| `brood-hoglet` \| `wild-hoglet` | The discrete unit of work |
| `ManagedBy` | n/a (not infra-resource-level) | Skip — hedgemony events aren't AWS resources |
| `purpose` | optional, e.g. `feedback-routing`, `pr-graph` | Future use |

These tags get written as **columns on `hedgemony_usage_event`** and **properties on `$ai_generation`** so cost dashboards in DoiT and product analytics in PostHog can slice the same way.

### The LLM Gateway is the canonical reference implementation

The LLM Gateway is the existing in-production example of per-product cost dimensioning at PostHog and the RFC explicitly calls it out as the model to follow. It exposes:

- `llm_gateway_product_cost_window_usd` — real-time spend per product within a time window
- `llm_gateway_product_cost_limit_usd` — configured spend cap per product
- `LLMGatewayProductCostApproachingLimit` alert at **80%** of cap
- `LLMGatewayProductCostLimitExceeded` hard-limit at **100%** of cap
- Per-user cost limits separately (`LLMGatewayUserCostLimitExceeded`)

**We mirror these naming and threshold conventions exactly** so dashboards and runbook patterns transfer. Our metrics:

- `hedgemony_nest_cost_window_usd` / `hedgemony_nest_cost_limit_usd`
- `hedgemony_hoglet_cost_window_usd` / `hedgemony_hoglet_cost_limit_usd`
- `hedgemony_user_cost_window_usd` (per-operator across all their nests)
- `HedgemonyNestCostApproachingLimit` (80%), `HedgemonyNestCostLimitExceeded` (100%)

### Asymmetric attribution surfaces

Hedgemony has **two distinct billing surfaces**, and the plan handles both:

| Surface | Cost source | Gateway-side attribution | Our action |
|---|---|---|---|
| **Hedgehog tick** (`LlmGateway.promptWithTools`) | Token counts from gateway response; cost computed via pricing table (gateway doesn't return `$`) | Already attributed to `product:posthog-code` at the gateway; gateway enforces global product cap | Write a `hedgemony_usage_event` row with `workload:hedgehog-tick` for fine-grained per-nest attribution we don't get from the gateway |
| **Hoglet** (cloud TaskRun → Claude Agent SDK) | `total_cost_usd` per turn directly from Claude SDK | Cloud TaskRun billing is separate from the LLM Gateway path | Capture via `_posthog/usage_update` notification, write `hedgemony_usage_event` with `workload:brood-hoglet` or `wild-hoglet` |

The gateway client at `apps/code/src/main/services/llm-gateway/service.ts:67-113` derives `product` from the OAuth credential — we can't pass `product:hedgemony` to it from this side. So our per-nest / per-hoglet caps are **layered fine-grained controls on top** of the gateway's global product cap, not a replacement.

---

## Data Model Changes

### New table: `hedgemony_usage_event` (append-only)

In `apps/code/src/main/db/schema.ts`, mirroring shape of `hedgemony_feedback_event`. Columns split into **attribution**, **FinOps tags** (per RFC), and **usage metrics**.

| Group | Column | Type | Notes |
|---|---|---|---|
| Attribution | `id` | UUIDv7 | PK |
| Attribution | `nestId` | text, FK→nest, nullable | NULL for wild hoglets |
| Attribution | `hogletId` | text, FK→hoglet, nullable | NULL for hedgehog ticks |
| Attribution | `taskId` | text, nullable | Cloud task id |
| Attribution | `taskRunId` | text, nullable | Cloud taskrun id (time-on-task correlation + dedupe) |
| Attribution | `turnIndex` | integer, nullable | Monotonic per `(taskRunId)` — dedupe key |
| FinOps tag | `team` | text default `'posthog-code'` | Per RFC |
| FinOps tag | `product` | text default `'hedgemony'` | Per RFC; **fine-grained** beyond gateway's `posthog-code` |
| FinOps tag | `environment` | text | `dev` / `prod-us` / `prod-eu` |
| FinOps tag | `system` | text default `'hedgemony'` | Per RFC |
| FinOps tag | `workload` | enum `"hedgehog-tick" \| "brood-hoglet" \| "wild-hoglet"` | Per RFC; subsumes a generic `role` column |
| FinOps tag | `purpose` | text, nullable | Optional sub-categorization (e.g. `feedback-routing`, `pr-graph`); leave null for v1 |
| Usage | `model` | text | e.g. `"claude-opus-4-7"`, `"gpt-5.5"` |
| Usage | `inputTokens` | integer | |
| Usage | `outputTokens` | integer | |
| Usage | `cacheReadTokens` | integer | |
| Usage | `cacheCreationTokens` | integer | |
| Usage | `costUsd` | real | From SDK, or computed (see below) |
| Usage | `costSource` | enum `"sdk" \| "pricing_table"` | Audit trail |
| Usage | `occurredAt` | text | ISO timestamp |

Indexes: `(nestId, occurredAt)`, `(hogletId, occurredAt)`, `(occurredAt)`, `(workload, occurredAt)`, **unique** `(taskRunId, turnIndex)` for hoglet idempotency.

### Column additions

- `hedgemony_hoglet`: add `model text`, `totalCostUsd real default 0`, `totalInputTokens integer default 0`, `totalOutputTokens integer default 0`, `totalCacheReadTokens integer default 0`, `totalCacheCreationTokens integer default 0`, `lastUsageAt text`.
- `hedgemony_nest`: add same `total*` columns + `budgetUsd real` (nullable; null = no cap).
- `NestLoadout` (loadout JSON in nest row): add optional `budgetUsd?: number` and `perHogletBudgetUsd?: number` fields in `apps/code/src/main/services/hedgemony/schemas.ts`.

### Migration

New file: `apps/code/src/main/db/migrations/00XX_hedgemony_finops.sql` (next available number — confirm by listing the directory at implementation time). One migration covers table + column adds.

---

## Phase A — Foundation: instrument and persist

**Goal:** every Claude API turn (hoglet, hedgehog) lands in `hedgemony_usage_event` and updates rolling totals on hoglet + nest rows.

### Files to create

- `apps/code/src/main/services/hedgemony/usage-pricing.ts` — `Record<model, { inputPer1M, outputPer1M, cacheReadPer1M, cacheCreationPer1M }>` constant plus `computeCostUsd(usage, model)` helper. Covers Claude Opus 4.7, Sonnet 4.6, Haiku 4.5, GPT-5.5 (Codex). Used as fallback only.
- `apps/code/src/main/db/repositories/usage-event-repository.ts` — `insert`, `findByNest(nestId, since)`, `findByHoglet(hogletId, since)`, `aggregateByNest(nestId)`.
- `apps/code/src/main/services/hedgemony/usage-attribution-service.ts` — subscribes to agent `usage_update` notifications (see wiring below), looks up `taskId → hogletId → nestId`, writes a `hedgemony_usage_event` row, increments `total*` columns on hoglet + nest. Idempotency-keyed on `(taskRunId, turnIndex)` to survive crash/replay.

### Files to modify

- `packages/agent/src/adapters/claude/conversion/sdk-to-acp.ts:791-813` — populate `costUsd` from `result.total_cost_usd` (currently typed but unfilled).
- `packages/agent/src/adapters/claude/claude-agent.ts:551-563` — the `_posthog/usage_update` notification already carries `cost`; extend payload with `model` (read from `message.modelUsage` keys) and a monotonic `turnIndex` so the consumer can dedupe.
- `apps/code/src/main/services/agent/service.ts` (or wherever `_posthog/usage_update` should be subscribed in main) — add subscription that forwards into `UsageAttributionService.recordHogletTurn(...)`. Use file path from existing `posthog-plugin/service.ts` pattern as the model for plugging extension notifications in main.
- `apps/code/src/main/services/hedgemony/hedgehog-tick-service.ts:610-621` — call `UsageAttributionService.recordHedgehogTick({ nestId, model: response.model, usage: response.usage })` immediately after the existing `summariseLlmResponse` call. LlmGateway already returns `{inputTokens, outputTokens}` but not cache counts — for v1, leave cache counts at 0 for hedgehog ticks, computed cost via pricing table.
- `apps/code/src/main/services/hedgemony/hoglet-service.ts:473,504,568` — when creating the hoglet row, also write the resolved `runtime.model` into the new `model` column.
- `apps/code/src/main/db/repositories/hoglet-repository.ts` and `nest-repository.ts` — atomic `incrementUsage(...)` methods (UPDATE `total*` columns + `lastUsageAt`).
- `apps/code/src/main/di/tokens.ts` and `apps/code/src/main/di/container.ts` — register `UsageAttributionService` and `UsagePricing`.

### Verification

- Unit tests: `usage-pricing.test.ts` (known token counts → known cost), `usage-attribution-service.test.ts` (mock SDK message → expected DB rows), `usage-event-repository.test.ts`.
- Integration: spawn a hoglet locally, run for one turn, verify `hedgemony_usage_event` has a row and `hedgemony_hoglet.totalCostUsd > 0` via SQLite browser.
- Cross-check: cumulative `costUsd` across event rows for one taskrun should match the SDK's `total_cost_usd` of the final result message (within float tolerance).

---

## Phase B — UI: observability

**Goal:** see what every hoglet and nest is costing.

### Files to create

- `apps/code/src/renderer/features/hedgemony/components/SpendChip.tsx` — small `$0.42` chip with cache-efficiency icon, fed from store.
- `apps/code/src/renderer/features/hedgemony/components/NestSpendTab.tsx` — total + per-hoglet breakdown + 7-day sparkline + cost-by-model donut.

### Files to modify

- `apps/code/src/main/trpc/routers/hedgemony.ts` — three new procedures: `getNestSpendSummary(nestId) → { total, byHoglet[], byModel[] }`, `getNestSpendTimeline(nestId, bucket) → series`, `getHogletSpend(hogletId) → { total, lastUsageAt }`. Plus a subscription `onSpendUpdated(nestId)` so chips refresh live.
- `apps/code/src/renderer/features/hedgemony/stores/nestStore.ts` and `hogletStore.ts` — cache `totalCostUsd` and `lastUsageAt` on cached entities; the watch subscription already covers these once they're on the row.
- Existing nest detail and hoglet card components — render `<SpendChip>` and (for nest detail) add the spend tab.

### Verification

- Click a nest with active spend; chip on each hoglet card matches sum of taskrun events.
- Spawn a fresh hoglet; chip goes from `$0.00` to non-zero within one turn (live via subscription).

---

## Phase C — PostHog telemetry

**Goal:** emit `$ai_generation` per turn to project 2 on us.posthog.com so we get LLM Analytics, cluster analysis, cost-by-feature, cross-user dashboards for free.

### Files to create

- `apps/code/src/main/services/posthog-llm-analytics.ts` — separate `PostHog` client targeting `us.posthog.com` with project-2 API key (env var, e.g. `VITE_POSTHOG_LLM_ANALYTICS_KEY`). Single function `captureAiGeneration({ traceId, distinctId, model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, costUsd, properties })`. Wraps `posthog-node`. Uses canonical `$ai_generation` event shape with required properties: `$ai_model`, `$ai_input_tokens`, `$ai_output_tokens`, `$ai_total_cost_usd`. **Custom properties on every event** (per FinOps RFC, so the same DoiT-style allocations work in PostHog dashboards): `team`, `product`, `environment`, `system`, `workload`, `purpose`, plus hedgemony-specific `nest_id`, `hoglet_id`, `task_id`, `task_run_id`.

### Files to modify

- `apps/code/src/main/services/hedgemony/usage-attribution-service.ts` (from Phase A) — after persisting the event row, call `captureAiGeneration(...)`. Pass `traceId = taskRunId`, `distinctId = currentUserId ?? "anonymous-hedgemony"`.
- `.env.example` — document the new env var.
- `apps/code/src/main/services/posthog-analytics.ts` — keep as-is (internal-c analytics is separate from product telemetry).

### Verification

- After one hoglet turn, query project 2 via PostHog MCP: `SELECT count() FROM events WHERE event = '$ai_generation' AND timestamp > now() - INTERVAL 1 HOUR` should be ≥ 1.
- The event should carry `nest_id` and `hoglet_id` properties; confirm via MCP `events-list`.

---

## Phase D — Enforcement / ceilings

**Goal:** stop runaway spend before it becomes a bill. Mirror LLM Gateway conventions exactly.

Model: each nest has an optional `budgetUsd` (loadout) and `perHogletBudgetUsd`. **Soft warning at 80%, hard refuse at 100%** — matching LLM Gateway's `LLMGatewayProductCostApproachingLimit` / `LLMGatewayProductCostLimitExceeded` thresholds.

**Layering note:** the LLM Gateway already enforces a global `posthog-code` product cap server-side for hedgehog ticks. Our caps are **fine-grained client-side controls** that fire well before the gateway cap (per-nest, per-hoglet). For hoglet TaskRuns, ours are the only client-side enforcement.

### Naming alignment (per RFC's LLM Gateway precedent)

| Our metric | LLM Gateway equivalent |
|---|---|
| `hedgemony_nest_cost_window_usd` | `llm_gateway_product_cost_window_usd` |
| `hedgemony_nest_cost_limit_usd` | `llm_gateway_product_cost_limit_usd` |
| `hedgemony_hoglet_cost_window_usd` | (new, finer grain) |
| `hedgemony_hoglet_cost_limit_usd` | (new, finer grain) |
| `hedgemony_user_cost_window_usd` | (per-user, same pattern as gateway's user-cost) |
| Alert `HedgemonyNestCostApproachingLimit` (80%) | `LLMGatewayProductCostApproachingLimit` |
| Alert `HedgemonyNestCostLimitExceeded` (100%) | `LLMGatewayProductCostLimitExceeded` |

These metrics are surfaced (a) as PostHog event properties on `$ai_generation` (Phase C) and (b) as `usage-summary` tRPC procedures the UI reads from (Phase B). No Prometheus/Grafana — this is a desktop app.

### Files to create

- `apps/code/src/main/services/hedgemony/budget-guard-service.ts` — `checkSpawn(nestId): { allowed, remaining, reason? }` and `checkRaise(hogletId): { allowed, remaining, reason? }`. Reads totals from repositories. Pure read service.

### Files to modify

- `apps/code/src/main/services/hedgemony/hedgehog-handlers/spawn-hoglet-handler.ts:9-22` — call `BudgetGuard.checkSpawn(nestId)` before the existing `TickBudget` check. On refusal, return a structured tool error explaining the cap. Mirror in `raise-hoglet-handler.ts:9-22`.
- `apps/code/src/main/services/hedgemony/hedgehog-tick-service.ts` — at the top of each tick, call `BudgetGuard.checkTick(nestId)`. If at hard cap, skip the tick and mark the nest `needs_attention` with reason `"budget_exceeded"` (existing `health` enum already supports nest health states; status enum supports `needs_attention`).
- `apps/code/src/main/trpc/routers/hedgemony.ts` — new mutation `setNestBudget({ nestId, budgetUsd, perHogletBudgetUsd })`. Updates loadout JSON.
- `apps/code/src/renderer/features/hedgemony/components/` — `BudgetSettings.tsx` in nest detail (or loadout dialog). Renders current spend / budget with progress bar.

### Verification

- Set a nest budget to `$0.10`, spawn a hoglet, run one expensive turn — next `spawn_hoglet` tool call should return refused with `reason: "budget_exceeded"`.
- Unit-test `BudgetGuard` with fixtures at 79%, 80%, 99%, 100%, 101% to confirm soft/hard thresholds.

---

## Phase E — Cost-aware orchestration

**Goal:** the hedgehog can see the budget and make smart decisions (skip low-value work, downgrade a hoglet's model, request more budget).

### Files to modify

- `apps/code/src/main/services/hedgemony/hedgehog-prompts.ts` — inject a "Budget" block into the hedgehog system/user prompt: current nest spend, budget remaining, top spenders among hoglets. Shape: `Budget: $4.20 spent of $10 cap ($5.80 remaining). Top hoglet: hoglet-abc ($2.10).`
- `apps/code/src/main/services/hedgemony/hedgehog-tools.ts` — add tool `request_budget_increase({ amountUsd, justification })` — emits an audit + operator notification; does **not** auto-grant.
- Optionally add `set_hoglet_model({ hogletId, model })` so the hedgehog can downgrade a chatty hoglet to Sonnet. Out of scope if model-switching mid-run breaks the cloud TaskRun contract; defer.
- Tool result for `spawn_hoglet` / `raise_hoglet` — extend the success response to include `"Budget remaining: $X.XX"` so the hedgehog gets feedback after each spend action.

### Verification

- Manual: set a low budget, observe the hedgehog reasoning visibly mentioning budget in audit entries, calling `request_budget_increase` rather than blindly spawning.
- The `request_budget_increase` tool call should appear as an audit `NestMessage` with `kind: "audit"`.

---

## Cross-cutting verification (after all phases)

1. `pnpm --filter code typecheck` clean.
2. `pnpm --filter code test` — new unit tests pass; existing hedgemony tests still pass.
3. End-to-end: spawn nest → spawn 2 hoglets → run each for several turns → confirm:
   - SQLite `hedgemony_usage_event` has rows
   - `hedgemony_nest.totalCostUsd` ≈ sum of event rows
   - Nest detail UI shows chips matching the totals
   - PostHog project 2 has `$ai_generation` events tagged with the right `nest_id`
   - Setting a low budget causes the next `spawn_hoglet` to refuse
   - Hedgehog audit entries reference budget

---

## Open detail to resolve at implementation time

- **Pricing-table maintenance:** pricing in `usage-pricing.ts` is hard-coded. Acceptable for now; revisit if Anthropic/OpenAI prices change frequently. Could later read from a remote config.
- **Wild hoglet attribution at the event layer:** wild hoglets have `nestId = NULL`. The UsageAttributionService should still write an event with `workload: "wild-hoglet"` so telemetry captures them; only nest-level rollups exclude them.
- **PostHog distinct ID:** for hedgehog telemetry, use the user's PostHog distinct id from existing auth, falling back to `"anonymous-hedgemony"`. Same pattern as `posthog-analytics.ts:42`.
- **`environment` resolution:** `dev` is easy (local). For prod, hoglets run on cloud TaskRuns whose region (US/EU) is determined by the operator's PostHog project. Resolve from `authService.cloudRegion` → `prod-us` / `prod-eu` / `dev`. For hedgehog ticks, same logic — the gateway endpoint reveals the region.
- **`system` value:** RFC suggests narrower-than-`product`. Recommendation: use `system:hedgemony` for now since hedgemony is its own system within `product:posthog-code`'s broader scope. Revisit when more posthog-code subsystems onboard to FinOps tagging.
- **Future: pass `product:hedgemony` to LLM Gateway:** if the gateway adds support for a client-supplied `product` header/dimension (without it, the gateway sees us all as `posthog-code`), we'd plumb it through `LlmGatewayService.prompt` so gateway-side caps could be finer-grained. Not in scope for v1 — gateway-side change is out of our control.

---

## Critical files (quick index)

**Will modify:**
- `apps/code/src/main/db/schema.ts:98-237`
- `apps/code/src/main/db/migrations/` (new file)
- `apps/code/src/main/db/repositories/hoglet-repository.ts`, `nest-repository.ts`
- `apps/code/src/main/services/hedgemony/schemas.ts:454-475` (loadout)
- `apps/code/src/main/services/hedgemony/hedgehog-tick-service.ts:610-621`
- `apps/code/src/main/services/hedgemony/hedgehog-handlers/spawn-hoglet-handler.ts:9-22`
- `apps/code/src/main/services/hedgemony/hedgehog-handlers/raise-hoglet-handler.ts:9-22`
- `apps/code/src/main/services/hedgemony/hoglet-service.ts:473,504,568`
- `apps/code/src/main/services/hedgemony/hedgehog-prompts.ts`, `hedgehog-tools.ts`
- `apps/code/src/main/trpc/routers/hedgemony.ts`
- `apps/code/src/main/di/tokens.ts`, `di/container.ts`
- `packages/agent/src/adapters/claude/conversion/sdk-to-acp.ts:791-813`
- `packages/agent/src/adapters/claude/claude-agent.ts:551-563`

**Will create:**
- `apps/code/src/main/services/hedgemony/usage-pricing.ts`
- `apps/code/src/main/services/hedgemony/usage-attribution-service.ts`
- `apps/code/src/main/services/hedgemony/budget-guard-service.ts`
- `apps/code/src/main/services/posthog-llm-analytics.ts`
- `apps/code/src/main/db/repositories/usage-event-repository.ts`
- `apps/code/src/renderer/features/hedgemony/components/SpendChip.tsx`
- `apps/code/src/renderer/features/hedgemony/components/NestSpendTab.tsx`
- `apps/code/src/renderer/features/hedgemony/components/BudgetSettings.tsx`
