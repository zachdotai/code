# Porting the AI gateway usage page to a canvas

**Status:** Implemented as a built-in React-tier template.
**Source:** PostHog/posthog#64511 — `products/ai_gateway/frontend/` (kea scene).
**Reference pattern:** the `dashboard` / `web-analytics` React templates in
`canvasTemplates.ts` (`FREEFORM_DASHBOARD_RULES`, `FREEFORM_WEB_ANALYTICS_RULES`).

## Approach: a React-tier "AI gateway" template

The page is a data board — a KPI row, a spend-per-day chart, a by-model table,
and a "Connect your app" panel. Canvas data boards now live on the **React
(freeform) tier**: the agent writes a single-file React app that runs in the
sandbox and talks to PostHog through the injected `ph` shim. So the AI gateway
ships as another opinionated React template alongside `dashboard` and
`web-analytics`, not on the older json-render tier.

What the React tier buys us over a hand-built kea scene: the board owns its own
`DateTimePicker`, re-queries on window change, and re-renders live — and the
"Connect your app" switch is real React state (`useState`) + Quill `Button`s, so
the provider/language toggle and snippet rendering are native, not reconstructed
from declarative `visible` conditions.

## Source → canvas mapping

| Source element (Cloud) | Canvas equivalent | HogQL |
| --- | --- | --- |
| Title + tagline | Quill `Heading` + muted `Text` | — |
| Spend tile | `Card` KPI | `round(sum(toFloat(properties.$ai_total_cost_usd)), 4)` |
| Requests tile | `Card` KPI | `count()` |
| Input tokens tile | `Card` KPI | `sum(toFloat(properties.$ai_input_tokens))` |
| Output tokens tile | `Card` KPI | `sum(toFloat(properties.$ai_output_tokens))` |
| Spend-per-day bar sparkline | `recharts` BarChart | `toStartOfDay(timestamp) AS day` grouped/ordered by day; `round(sum(...$ai_total_cost_usd), 4)` per day |
| By-model `LemonTable` | Quill `Table` | `coalesce(properties.$ai_model,'unknown'), count(), sum(input+output tokens), round(sum(cost),4)` group by model order by cost desc |
| Provider/language snippet tabs | React `useState` provider/language + Quill `Button`s; the matching SDK snippet in a code block | — |
| Empty-state intro | A single "No gateway usage yet" `Card` + the connect section only | `count()` probed at build time via MCP |

Every query carries the **exact gateway filter**
`event = '$ai_generation' AND properties.$ai_gateway = true`. There is no typed
query node for the `$ai_gateway` predicate, so the board uses inline HogQL (the
`ph.query` escape hatch) and ANDs it with the half-open window from the date
control (`timestamp >= toDateTime(fromUnix) AND timestamp < toDateTime(toUnix)`)
— never a baked-in `now() - INTERVAL` on the live queries. The metric formulas
are copied verbatim from the kea scene, not paraphrased.

## Open questions / blockers

- **Gateway base URL (blocker, not guessed).** Cloud reads
  `preflight.ai_gateway_url` (`AI_GATEWAY_PUBLIC_URL`). Code has no preflight, and
  the only host in the repos is the dev tailnet box
  (`http://ai-gateway-dev.hedgehog-kitefin.ts.net`), not a public prod URL. The
  template emits a literal `<gateway base URL>` placeholder in every snippet for
  the user to fill. To make snippets paste-ready we need to decide where the host
  comes from: a build/runtime config constant, an env var mirrored into the
  renderer, or a small API/MCP call. Left as a follow-up.
- **Balance / top-up card + modal.** Mocked in Cloud (`GatewayTopUp.tsx`).
  Dropped from the port — out of scope until the billing API is real.
- **Empty-state detection.** Cloud waits for two queries, then shows the intro if
  `requests === 0 && modelUsage.length === 0`. The template tells the agent to
  probe `count()` under the gateway filter (literal last-30-day window) at build
  time and, if zero, render only the title + intro + connect section.

## What was added (implementation)

The board reuses main's React-tier machinery — no new catalog component, router,
or schema plumbing. `dashboard` and `web-analytics` already proved the pattern.

- `packages/core/src/canvas/canvasTemplates.ts`
  - `GATEWAY_BASE_FILTER` — the exact gateway predicate, shared by every query.
  - `GATEWAY_EMPTY_STATE_WHERE` — the predicate bounded to a literal 30-day
    window for the build-time empty-state probe (composed from the base filter so
    it can't drift).
  - `CONNECT_SNIPPETS` — the six SDK snippets, verbatim from `AIGatewayScene.tsx`.
  - `FREEFORM_AI_GATEWAY_RULES` — the opinionated React rules (title, gateway
    filter, layout, metric HogQL, the connect switch, empty state) plus the shared
    `FREEFORM_QUILL_RULES` + `FREEFORM_DATE_CONTROL_RULES`.
  - An `"ai-gateway"` entry in `FREEFORM_SYSTEM_PROMPTS` (so `freeformSystemPromptFor`
    resolves the rich prompt for a canvas with that `templateId`) and an
    `AI_GATEWAY_TEMPLATE` in `BUILT_IN_TEMPLATES` (so it shows in the create picker).
- `packages/core/src/canvas/canvasTemplates.test.ts` — asserts the template is a
  selectable built-in, resolves a distinct React-tier prompt, and bakes the exact
  gateway filter, the metric formulas, the date-control window, the snippets, and
  the empty-state probe.

## Checks

- `pnpm --filter @posthog/core test -- --run src/canvas/canvasTemplates.test.ts`
- `pnpm --filter @posthog/core typecheck` (after building workspace dist deps)
- `biome lint packages/core/src/canvas`
