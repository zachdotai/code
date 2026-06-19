# Porting the AI gateway usage page to a canvas

**Status:** Implemented as a built-in declarative template (option A).
**Source:** PostHog/posthog#64511 — `products/ai_gateway/frontend/` (kea scene).
**Reference pattern:** PostHog/code#2657 — the web-analytics built-in template.

## Recommendation: (A) a built-in declarative "AI gateway" template

The page **is a dashboard** — a KPI row, a spend-per-day chart, and a by-model
table, all reading HogQL over the events table. That is exactly the declarative
catalog's home turf, and the team's stance (TEMPLATES.md) is declarative-first
for built-in boards. Going declarative also gets us, for free, the things the
hand-built kea scene doesn't have: per-card refresh, a toolbar date picker that
rescopes every query, and inline editing — because the board records its HogQL
under `state.queries` and rides the existing `dashboard-query` refresh path.

The cost is the **"Connect your app" panel**: a provider × language snippet
switch with copy buttons. The catalog has no tab/segmented-control/copy-button
primitive, so the switch is rebuilt declaratively from `Button` + `state` +
`visible` (see below). That reproduces the *behaviour* (pick provider, pick
language, see the snippet) but not the exact segmented-button/tab chrome or the
one-click copy. That is the one lossy seam.

**Why not (B) freeform React?** It would port the page near 1:1 — real tabs, a
real copy button — but a freeform canvas is a sandboxed-iframe React file: not
refreshable, not inline-editable, not date-range-driven, and off the
declarative-first path the built-ins are meant to model. For a board that is 80%
dashboard, paying that price to recover tab chrome is the wrong trade.

**Verdict:** ship the whole page as **one declarative template** (done). If the
connect/onboarding half ever needs pixel-faithful tabs + copy, split *only that
section* into a freeform piece — don't drop the analytics board to freeform to
get it. The declarative switch is good enough for v1.

## Source → canvas mapping

| Source element (Cloud) | Canvas equivalent | HogQL | Shape |
| --- | --- | --- | --- |
| Title + tagline | `Heading` (level 1) + muted `Text` | — | — |
| Spend tile | `Stat` `stat_spend` `/value` | `round(sum(toFloat(properties.$ai_total_cost_usd)), 4)` | scalar |
| Requests tile | `Stat` `stat_requests` `/value` | `count()` | scalar |
| Input tokens tile | `Stat` `stat_input_tokens` `/value` | `sum(toFloat(properties.$ai_input_tokens))` | scalar |
| Output tokens tile | `Stat` `stat_output_tokens` `/value` | `sum(toFloat(properties.$ai_output_tokens))` | scalar |
| Spend-per-day bar sparkline | `BarChart` `chart_spend_per_day` (`/labels` + `/series/0/data`) | `toStartOfDay(timestamp)` grouped/ordered by day; `round(sum(...$ai_total_cost_usd), 4)` per day | labels + column |
| By-model `LemonTable` | `Table` `table_by_model` `/rows` | `coalesce(properties.$ai_model,'unknown'), count(), sum(input+output tokens), round(sum(cost),4)` group by model order by cost desc | matrix |
| Provider/language snippet tabs | `Button`s → `setState` `/provider`, `/language`; six `Markdown` code blocks gated by `visible` (implicit-AND array of two `$state` `eq` conditions) | — | — |
| Empty-state intro hero | `Hero` (tone accent) + the connect section only | `count()` probed at build time via MCP | — |

Every query carries the **exact gateway filter**
`event = '$ai_generation' AND properties.$ai_gateway = true`. The only adaptation
from source is the time bound: the kea scene bakes `now() - INTERVAL 30 DAY`;
the canvas uses the `{date_from}`/`{date_to}` placeholders + `state.dateRange`
("Last 30 days") so the board is refreshable and the picker can rescope it — the
required canvas convention, not a deviation. The metric formulas are copied
verbatim, not paraphrased.

## Open questions / blockers

- **Gateway base URL (blocker, not guessed).** Cloud reads
  `preflight.ai_gateway_url` (`AI_GATEWAY_PUBLIC_URL`). Code has no preflight, and
  the only host in the repos is the dev tailnet box
  (`http://ai-gateway-dev.hedgehog-kitefin.ts.net`), not a public prod URL. The
  template emits a literal `<gateway base URL>` placeholder in every snippet for
  the user to fill. To make the snippets paste-ready we need to decide where the
  host comes from: (a) a build/runtime config constant, (b) an env var mirrored
  into the renderer, (c) a small API/MCP call, or (d) hardcode per environment.
  Recommend (a)/(b): inject it once and have the template substitute it like
  `{date_from}`. Left as a follow-up.
- **Balance / top-up card + modal.** Mocked in Cloud (`GatewayTopUp.tsx`,
  `lemonToast.info("… is mocked for now")`). Dropped from the port — out of scope
  until the billing API is real.
- **Empty-state detection.** Cloud waits for two queries to resolve, then shows
  the intro if `requests === 0 && modelUsage.length === 0`. A canvas is built
  once from data the agent fetches via MCP, so detection moves to **build time**:
  the template tells the agent to probe `count()` under the gateway filter first
  and, if zero, render only the title + intro `Hero` + connect section, skipping
  the would-be-zeroed board.
- **Contiguous 30-day padding.** Cloud's `buildSpendChartData` pads idle days to
  a gap-free 30-point series. The declarative chart plots only days with data
  (labels + data come from parallel `GROUP BY day` queries, so they stay
  aligned). Minor fidelity loss; recoverable later with HogQL `WITH FILL`.
- **Selected-toggle styling.** `Button.variant` is a literal enum, not
  state-bindable, so the active provider/language button isn't highlighted —
  selection shows only via which snippet is visible. Cosmetic; a state-bound
  variant would need a catalog change.
- **Currency formatting.** The catalog `Stat` formats values with a generic
  `Intl.NumberFormat` (thousands separators only), so the Spend KPI can't render
  as `$12.35` like the Cloud page's `humanFriendlyCurrency`. The unit is carried
  in the label ("Spend (USD)") instead; a principled fix is a `format` prop on
  `Stat`, out of scope here.
- **New-template host wiring.** A data-driven template must also be added to
  `DATA_TEMPLATES` in `WebsiteLayout.tsx` (ui) or it renders with no date picker
  and no toolbar refresh. That's a parallel list to the core template registry —
  worth collapsing into a `dataTemplate` flag on the template record so the two
  can't drift.

## What was added (implementation)

Self-contained — no new catalog component, router, or registry plumbing was
needed (unlike #2657, which added `Heatmap`/`RetentionGrid`). The board reuses
existing components (`Stat`, `BarChart`, `Table`, `Markdown`, `Button`, `Hero`,
`Section`) and the existing `state.queries` refresh + `state.dateRange` machinery.

- `packages/core/src/canvas/canvasTemplates.ts`
  - `AI_GATEWAY_COMPONENTS` allow-list (`DASHBOARD_COMPONENTS` + `Section`,
    `Markdown`, `Hero`).
  - `GATEWAY_WHERE` constant (the exact filter, with date placeholders).
  - `CONNECT_SNIPPETS` — the six SDK snippets, verbatim from `AIGatewayScene.tsx`.
  - `AI_GATEWAY_RULES` — title, gateway filter, time window, the four Stats, the
    spend chart, the by-model table, the declarative connect switch, and the
    empty state — all baked so the agent reproduces the board faithfully.
  - An `ai-gateway` entry in `BUILT_INS` (name, description, system, rules,
    allow-list, starter suggestions). It auto-registers via `BUILT_IN_TEMPLATES`
    → `CanvasTemplatesService` and shows up in the create picker; no other wiring.
- `packages/core/src/canvas/canvasTemplates.test.ts` — asserts the template is
  registered and that the prompt bakes the exact gateway filter, the metric
  formulas, the date placeholders (not a baked interval), the snippets, and the
  provider/language switch.

## Checks

- `pnpm --filter @posthog/core exec vitest run src/canvas/` — 6 files, 53 tests pass.
- `pnpm --filter @posthog/core typecheck` — clean (after building workspace dist deps).
- `biome lint packages/core/src/canvas/canvasTemplates.ts canvasTemplates.test.ts` — clean.
