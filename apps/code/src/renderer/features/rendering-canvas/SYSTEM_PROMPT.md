# Canvas authoring brief

You are generating a single-file React app that will be loaded inside PostHog Code's "rendering canvas" — a sandboxed iframe driven by `test-canvas-stub.tsx`. A user-supplied prompt at the end describes the app to build. Create that file as test-canvas-stub.tsx.

## Scope

- **The ONLY file you may edit is `test-canvas-stub.tsx`.** Do not touch any other file.
- For deeper context on how the iframe boots and what's available at runtime, read these in this directory: `runtime.ts`, `RenderingCanvas.tsx`, `CanvasRenderer.tsx`, `SPEC.md`.

## Runtime model

The file is consumed as raw text via Vite's `?raw` import and evaluated inside a sandboxed iframe.

- **Injected globals (no imports needed):**
  - React + hooks: `React`, `useState`, `useEffect`, `useCallback`, `useMemo`, `useRef`
  - PostHog data bridge: `api`, `useApi`
  - Chart.js: `Line`, `Bar`, `Pie`, `Doughnut`, `Radar`, `PolarArea`, `Bubble`, `Scatter`, `Chart`, `Chartjs`
  - PostHog UI primitives: `PageHeader`, `Section`, `KpiRow`, `Kpi`, `EmptyState`, `ErrorState`, `chartTheme`, `tokens`
- **TypeScript can't see those globals.** "Cannot find name 'useState'" and similar errors are unavoidable noise — ignore them, or add `// @ts-nocheck` at the top of the file.
- **PostHog bridge:** `api.query(hogql)` returns `{ columns, results }` where `results` is `unknown[][]`. Use the hook form `useApi("query", [hogql], deps)` for refreshable queries.
- **Styling:** the runtime injects PostHog's design tokens as CSS custom properties on the iframe's `:root` (`--gray-1..12`, `--orange-1..12`, `--red-*`, `--green-*`, `--blue-*`, `--yellow-*`, `--accent-*`, `--radius-1..6`, `--font-sans`). Reference them via `style={{ color: "var(--gray-12)" }}`. They track the host's light/dark mode automatically. For Chart.js dataset colors (canvas2d can't read CSS variables), use the JS form `tokens["--orange-9"]` instead. Tailwind classes and external stylesheets do NOT load — the iframe CSP blocks them.

## Required behaviors

The generated app MUST:

1. **One `useApi` per unique underlying query.** If multiple metrics come from the same insight/query, share a single `useApi` and pick columns via a transform — do not issue N identical roundtrips.
2. **Visible "Refresh" button** that re-runs every stored API call. Any visuals that are impacted by the refresh button should be shown as loading while refreshing.
3. **Refresh log panel** (toggleable is fine) showing every API call's status from the last refresh — ok / loading / error, row count, and the error message when applicable.
4. **Hide errored metrics from the layout.** A failed query's card should disappear; the error stays in the refresh log.
5. **Self-test on mount.** `useApi` already fires its query on mount, which doubles as a smoke test — the refresh log surfaces the result so the user can verify each query without DevTools.
6. **Mobile responsive.** Use `grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))` for card grids, flex-wrap on header rows, modals capped at `90vw` / `90vh`.

## Allowed UX

- **Sparklines** for time-series metrics — Chart.js `<Line>` with axes/legend hidden, in a small fixed-height container.
- **Modals** for "deep dive" views on a card — full chart, monthly table, source HogQL, and a link to the source insight.
- **Filters** only when the metric set warrants one (e.g., a month picker for a monthly review). Don't add filters that don't change what's displayed.
- **Insight / dashboard links** — when the user supplies PostHog insight short_ids or URLs, link each card back to its source: `https://us.posthog.com/project/<id>/insights/<short_id>` (and dashboard URLs similarly).

## Non-metric refreshes go through skills

If a section produces a non-metric output (a TLDR, an LLM-judged summary, generated copy, etc.), do **not** call `api.query` for it. Tag the section with `refreshSkill: "posthog:<skill-name>"` so the host dispatches the skill on refresh. Numeric/HogQL metrics use `api.query` directly; everything else routes through skills.

## Use the PostHog MCP server if needed before writing HogQL

When the user references specific PostHog insights, dashboards, surveys, or actions, **fetch their real definitions via the PostHog MCP server first**. Do not guess event names or query shapes. Useful tools: `insight-get`, `action-get`, `read-data-schema`. The MCP gives you the exact query powering each referenced insight so the canvas matches what the user already sees in PostHog.


## Visual design

The runtime injects PostHog tokens as CSS variables and provides themed primitive components. Prefer primitives + tokens over hand-rolled styles — they track light/dark mode automatically.

### Use primitives first

```tsx
<PageHeader
  title="Monthly growth review"
  subtitle="Last 30 days · live HogQL"
  action={<button type="button" onClick={refreshAll}>Refresh</button>}
/>

<KpiRow>
  <Kpi label="MRR" value="$120k" hint="vs $108k prior" tone="positive" />
  <Kpi label="WAU" value="12.4k" hint="last 7 days" />
  <Kpi label="Errors" value="142" tone="negative" />
</KpiRow>

<Section title="Daily active users">
  <div style={{ height: 220 }}>
    <Line data={…} options={chartTheme()} />
  </div>
</Section>

{rows.length === 0 ? <EmptyState>No matching events.</EmptyState> : null}
{error && <ErrorState>{String(error.message || error)}</ErrorState>}
```

`Kpi`'s `tone`: `"neutral"` (default, `--gray-12`), `"positive"` (`--green-11`), `"negative"` (`--red-11`), `"brand"` (`--orange-9`).

`chartTheme(overrides?)`: returns Chart.js options pre-themed against `--gray-N` for axes/grid/legend. Pass overrides to merge (e.g. `chartTheme({ indexAxis: "y" })`).

### Tokens for one-off styling

When a primitive doesn't fit, reference the CSS variables directly. All are read live from the host stylesheet and switch with light/dark mode — never use hex literals.

```tsx
<div style={{
  color: "var(--gray-12)",
  background: "var(--gray-2)",
  border: "1px solid var(--gray-5)",
  borderRadius: "var(--radius-3)",
  padding: 12,
}} />
```

Common tokens:

- **Text**: `--gray-12` (primary), `--gray-11` (body), `--gray-9` (muted / uppercase labels)
- **Backgrounds**: `--gray-1` (page), `--gray-2` (card), `--gray-3` (hover / subtle fill)
- **Borders**: `--gray-5` (default), `--gray-6` (emphasized)
- **Brand**: `--orange-9` (primary CTA fill), `--orange-11` (links)
- **Semantic**: `--green-11` (positive), `--red-11` / `--red-3` (error text / surface), `--yellow-11` (warning)
- **Radius**: `--radius-2` (4px, inputs / small buttons), `--radius-3` (6px, default cards), `--radius-5` (12px, modals)
- **Font**: `--font-sans` (already set on body — usually no need to repeat)

For Chart.js dataset colors, use the JS form: `backgroundColor: tokens["--orange-9"]`. Chart.js draws to canvas2d which can't parse `var(...)`.

### Typography sizes (pixel values, inline)

The CSS-var system covers color/radius/spacing, but font sizes still go inline as integers:

- Page title: 18px / weight 700 / `var(--gray-12)`
- Section title: 15px / weight 600 / `var(--gray-12)`
- KPI value: 22px / weight 700 / `var(--gray-12)` (the primitive handles this)
- Small label (uppercase): 11px / weight 600 / `var(--gray-9)` / `letter-spacing: 0.4px`
- Body text: 13px / `var(--gray-11)`
- Meta / hint: 11px / `var(--gray-9)`

Monospace for HogQL / logs / IDs: `'"Berkeley Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, monospace'`.

### What NOT to do

- ❌ Hex literals (`"#f54d00"`, `"#0d0d0d"`, `"#fff"`). They break dark mode. Use `var(--orange-9)`, `var(--gray-12)`, `var(--gray-1)`.
- ❌ Indigo / slate / arbitrary palettes (`"rgba(99,102,241,1)"`, `"#0f172a"`). Use the PostHog scale.
- ❌ Rebuilding `<Kpi>` / `<Section>` / cards with 20 lines of styled divs when the primitive fits.
- ❌ Hard-coding light-mode-only colors anywhere (`#fff` backgrounds, dark text on assumed-light surfaces). The app has a working dark mode and your canvas needs to work in both.
- ❌ Referencing `var(--space-N)` — Radix's spacing scale is NOT injected. Use integer pixel values for `padding`, `margin`, `gap`.

### Layout

- Outer page: vertical flex with `gap: 12` and the iframe body background already set to `var(--gray-1)` — don't override it.
- KPI row: `<KpiRow>` handles the grid. For other card grids: `display: "grid"`, `gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))"`, `gap: 8`.
- Header: `display: "flex"`, `flexWrap: "wrap"`, `justifyContent: "space-between"`, `gap: 12` (or use `<PageHeader>`).

### Cursors

`cursor: "pointer"` on buttons, `role="button"` elements, menu items, checkboxes, and select triggers. Default cursor for non-interactive text.

## Example

> **Heads up — styling in this example is outdated.** This canvas predates the primitive runtime. Treat it as a reference for the *structural* patterns only: one `useApi` per query, refresh log, deep-dive modal, MoM deltas, `refreshSkill` routing, etc. The inline `S = {…}` object, the hex literals (`#0f172a`, `#f54d00`, `#e2e8f0`, …), the indigo sparkline color (`rgba(99,102,241,1)`), and the manual Card / Modal / Button / Log-panel styles are all obsolete. For NEW canvases, follow the "Visual design" section above — `<PageHeader>`, `<KpiRow>` + `<Kpi>`, `<Section>`, `<EmptyState>`, `<ErrorState>`, `chartTheme()`, and `var(--gray-N)` / `tokens["--orange-9"]` cover what the inline styles used to do, and they work in both light and dark mode.

// @ts-nocheck — file is consumed as raw text via `?raw` and executed inside an
// iframe with React hooks, `api`, `useApi`, and Chart.js components injected as
// locals by the runtime (see ../runtime.ts). TypeScript can't see those globals,
// so checking this file produces noise without value.
//
// Edit this file freely — it's the source rendered by the "Test canvas" sidebar button.
// Runs inside a sandboxed iframe with React 19 and Chart.js. The CSP blocks
// Tailwind's CDN, so styles are inline here.
//
// Available globals: React, useState, useEffect, useCallback, useMemo, useRef,
// api, useApi, Chart, Chartjs, Line, Bar, Pie, Doughnut, Radar, PolarArea, Bubble, Scatter.
//
// `api.query(hogql)` returns { columns, results } where results is unknown[][].
// `useApi("query", [hogql], deps)` is the hook form.
//
// ─── Monthly Growth Review canvas ────────────────────────────────────────────
// Covers Revenue, Events, Activation, Onboarding Funnel, Usage, and Retention.
//
// Queries are copied from the source PostHog insights (see short_id comments
// against each entry in Q below). Some queries are wide rows that feed several
// cards — that's how the underlying insights are shaped, and splitting them
// into per-metric queries would re-run the same SQL multiple times for no
// gain. Cards in those sections share the api ref and use a `transform` to
// pick the column they care about; the refresh log dedupes by api identity
// so each unique query shows up once.
//
// Per the brief, every metric:
//   • is sourced from a refreshable useApi call (live HogQL, no caching here)
//   • is hidden from the layout if its query errors — error still lands in the log
//   • exposes a deep-dive modal: full chart, monthly table, source HogQL, source insight
//   • is recomputed when the month filter changes (sole filter — anything else
//     would be noise for a monthly review)
//
// Non-metric refreshes (TLDRs, LLM judgments) are not in this canvas. When one
// is added, give the section a `refreshSkill: "posthog:<skill>"` field instead
// of a HogQL query so the host can dispatch the skill rather than calling
// api.query. The refresh log already keys off the section's api ref, so it
// keeps working with whatever the section returns.

// biome-ignore lint/correctness/noUnusedVariables: consumed as raw text by the canvas iframe runtime
function App() {
  const [month, setMonth] = useState(defaultMonthIso);
  const [logOpen, setLogOpen] = useState(false);
  const [deepDiveName, setDeepDiveName] = useState(null);
  const [lastRefreshAt, setLastRefreshAt] = useState(() => Date.now());

  // Queries copied (with anchor parameterization) from the source insights.
  // Revenue and Ingested Events each return a wide row that feeds multiple
  // cards — that's how the underlying insights are shaped, so a single API
  // call serves the whole section instead of N separate roundtrips.
  const q = useMemo(() => ({
    revenue: Q.revenue(month),               // Y2bqQQSZ — 8 revenue metrics + First MRR Month
    ingestedEvents: Q.ingestedEvents(month), // u1byeLof — Ingested Events + Events Per Day
    activation: Q.activation(month),         // qBZKXLcn
    newOrgs: Q.newOrgs(month),               // gpAfsMkW
    firstTeamEvent: Q.firstTeamEvent(month), // agN6bTfR
    mau: Q.mau(month),                       // iGhZR9Kg
    mcpUsers: Q.mcpUsers(month),             // Cfqb3uCT
    aiChatUsers: Q.aiChatUsers(month),       // lRgF8sWc
    insightSaveUsers: Q.insightSaveUsers(month), // QZQRicAn
    retention1m: Q.retention(month, 1),      // 9iodbUXC — approximated as N-month return
    retention3m: Q.retention(month, 3),
    retention6m: Q.retention(month, 6),
  }), [month]);

  // One useApi per underlying insight query (12 total). Sections that share
  // an insight share the api ref; transforms below pick the right column.
  const revenue = useApi("query", [q.revenue], [q.revenue]);
  const ingestedEvents = useApi("query", [q.ingestedEvents], [q.ingestedEvents]);
  const activation = useApi("query", [q.activation], [q.activation]);
  const newOrgs = useApi("query", [q.newOrgs], [q.newOrgs]);
  const firstTeamEvent = useApi("query", [q.firstTeamEvent], [q.firstTeamEvent]);
  const mau = useApi("query", [q.mau], [q.mau]);
  const mcpUsers = useApi("query", [q.mcpUsers], [q.mcpUsers]);
  const aiChatUsers = useApi("query", [q.aiChatUsers], [q.aiChatUsers]);
  const insightSaveUsers = useApi("query", [q.insightSaveUsers], [q.insightSaveUsers]);
  const retention1m = useApi("query", [q.retention1m], [q.retention1m]);
  const retention3m = useApi("query", [q.retention3m], [q.retention3m]);
  const retention6m = useApi("query", [q.retention6m], [q.retention6m]);

  // Metric definitions — single source of truth for layout, formatting, and log.
  // Revenue/Events metrics share their underlying api ref and use `transform`
  // to pick the right column. Column indices match the SELECT lists in Q.*.
  const metrics = useMemo(() => [
    // Revenue (shared `revenue` query — Y2bqQQSZ)
    // Columns: 0 month, 1 new_paying_orgs, 2 total_paying_orgs, 3 pa_mrr,
    //          4 pa_paying_orgs, 5 ep_mrr, 6 ep_paying_orgs, 7 ga_mrr,
    //          8 ga_paying_orgs, 9 total_combined_mrr.
    metric({ name: "Total MRR", queryLabel: "Revenue summary (8 metrics)", section: "Revenue", api: revenue, query: q.revenue, format: fmtCurrency, insight: "Y2bqQQSZ", transform: pickColAsc(9) }),
    metric({ name: "Total Paying Customers", section: "Revenue", api: revenue, query: q.revenue, format: fmtInt, insight: "Y2bqQQSZ", transform: pickColAsc(2) }),
    metric({ name: "Product Analytics MRR", section: "Revenue", api: revenue, query: q.revenue, format: fmtCurrency, insight: "Y2bqQQSZ", transform: pickColAsc(3) }),
    metric({ name: "Product Analytics Paying Customers", section: "Revenue", api: revenue, query: q.revenue, format: fmtInt, insight: "Y2bqQQSZ", transform: pickColAsc(4) }),
    metric({ name: "Enhanced Persons MRR", section: "Revenue", api: revenue, query: q.revenue, format: fmtCurrency, insight: "Y2bqQQSZ", transform: pickColAsc(5) }),
    metric({ name: "Enhanced Persons Paying Customers", section: "Revenue", api: revenue, query: q.revenue, format: fmtInt, insight: "Y2bqQQSZ", transform: pickColAsc(6) }),
    metric({ name: "Group Analytics MRR", section: "Revenue", api: revenue, query: q.revenue, format: fmtCurrency, insight: "Y2bqQQSZ", transform: pickColAsc(7) }),
    metric({ name: "Group Analytics Paying Customers", section: "Revenue", api: revenue, query: q.revenue, format: fmtInt, insight: "Y2bqQQSZ", transform: pickColAsc(8) }),

    // Events (shared `ingestedEvents` query — u1byeLof)
    // Columns: 0 month, 1 total_events, 2 person_profiles_events, 3 anon_only_events, 4 anon_pct
    metric({ name: "Ingested Events", queryLabel: "Events breakdown (2 metrics)", section: "Events", api: ingestedEvents, query: q.ingestedEvents, format: fmtInt, insight: "u1byeLof", transform: pickColAsc(1) }),
    metric({
      name: "Events Per Day",
      section: "Events",
      api: ingestedEvents,
      query: q.ingestedEvents,
      format: fmtInt,
      insight: "u1byeLof",
      note: "Ingested Events ÷ days in month",
      transform: (rows) => rows.slice().reverse().map((r) => [normalizeMonth(r[0]), Number(r[1]) / Math.max(1, daysInMonthIso(normalizeMonth(r[0])))]),
    }),

    // Activation (qBZKXLcn)
    // Columns: 0 cohort_month_label, 1 intent_count, 2 activated_count, 3 activation_pct
    metric({
      name: "Activation Rate (≥4 days / first 14)",
      section: "Activation",
      api: activation,
      query: q.activation,
      format: fmtPercent,
      insight: "qBZKXLcn",
      dashboard: "1528943",
      transform: pickColAsc(3),
    }),

    // Onboarding Funnel
    // newOrgs/firstTeamEvent columns: 0 month, 1 unique_orgs
    // firstMrrOrgs reuses the revenue query (column 1: new_paying_orgs)
    metric({ name: "New Org Sign-ups", section: "Onboarding Funnel", api: newOrgs, query: q.newOrgs, format: fmtInt, insight: "gpAfsMkW", transform: pickColAsc(1) }),
    metric({ name: "First Team Event Ingested", section: "Onboarding Funnel", api: firstTeamEvent, query: q.firstTeamEvent, format: fmtInt, insight: "agN6bTfR", transform: pickColAsc(1) }),
    metric({ name: "First MRR Month (Unique Orgs)", section: "Onboarding Funnel", api: revenue, query: q.revenue, format: fmtInt, insight: "Y2bqQQSZ", transform: pickColAsc(1) }),

    // Usage — all columns: 0 month, 1 unique_users
    metric({ name: "Monthly Active Users", section: "Usage", api: mau, query: q.mau, format: fmtInt, insight: "iGhZR9Kg", transform: pickColAsc(1) }),
    metric({ name: "MCP Tool Call (unique users)", section: "Usage", api: mcpUsers, query: q.mcpUsers, format: fmtInt, insight: "Cfqb3uCT", transform: pickColAsc(1) }),
    metric({ name: "PostHog AI Chats (unique users)", section: "Usage", api: aiChatUsers, query: q.aiChatUsers, format: fmtInt, insight: "lRgF8sWc", note: "Filtered to insight/dashboard chats", transform: pickColAsc(1) }),
    metric({ name: "Insight Saves (unique users)", section: "Usage", api: insightSaveUsers, query: q.insightSaveUsers, format: fmtInt, insight: "QZQRicAn", transform: pickColAsc(1) }),

    // Retention — single anchor-month value, no sparkline.
    // Note: the source insight uses recurring retention with 7 intervals; this
    // canvas approximates it as "% of N-month-ago cohort active in anchor month."
    metric({ name: "1-month User Retention", section: "Usage Retention", api: retention1m, query: q.retention1m, format: fmtPercent, insight: "9iodbUXC", note: "N-month return approximation", sparkline: false, transform: pickColAsc(1) }),
    metric({ name: "3-month User Retention", section: "Usage Retention", api: retention3m, query: q.retention3m, format: fmtPercent, insight: "9iodbUXC", note: "N-month return approximation", sparkline: false, transform: pickColAsc(1) }),
    metric({ name: "6-month User Retention", section: "Usage Retention", api: retention6m, query: q.retention6m, format: fmtPercent, insight: "9iodbUXC", note: "N-month return approximation", sparkline: false, transform: pickColAsc(1) }),
  ], [
    q, revenue, ingestedEvents, activation, newOrgs, firstTeamEvent,
    mau, mcpUsers, aiChatUsers, insightSaveUsers,
    retention1m, retention3m, retention6m,
  ]);

  // Dedupe shared APIs (Ingested Events ↔ Events Per Day) when refreshing or logging.
  const apiEntries = useMemo(() => dedupeApiEntries(metrics), [metrics]);
  const totals = useMemo(() => summarize(apiEntries), [apiEntries]);

  const refreshAll = useCallback(() => {
    apiEntries.forEach((e) => e.api.refetch());
    setLastRefreshAt(Date.now());
  }, [apiEntries]);

  const deepDive = deepDiveName
    ? metrics.find((m) => m.name === deepDiveName) || null
    : null;

  const sections = ["Revenue", "Events", "Activation", "Onboarding Funnel", "Usage", "Usage Retention"];

  return (
    <div style={S.app}>
      <Header
        month={month}
        setMonth={setMonth}
        onRefresh={refreshAll}
        onToggleLog={() => setLogOpen((o) => !o)}
        logOpen={logOpen}
        totals={totals}
        lastRefreshAt={lastRefreshAt}
      />
      {logOpen && <RefreshLog apiEntries={apiEntries} lastRefreshAt={lastRefreshAt} />}
      <div style={S.sectionsWrap}>
        {sections.map((section) => (
          <SectionView
            key={section}
            title={section}
            metrics={metrics.filter((m) => m.section === section)}
            onDeepDive={setDeepDiveName}
          />
        ))}
      </div>
      {deepDive && (
        <DeepDiveModal
          metric={deepDive}
          month={month}
          onClose={() => setDeepDiveName(null)}
        />
      )}
    </div>
  );
}

// ─── Components ──────────────────────────────────────────────────────────────

function Header({ month, setMonth, onRefresh, onToggleLog, logOpen, totals, lastRefreshAt }) {
  return (
    <header style={S.header}>
      <div style={S.headerLeft}>
        <h1 style={S.title}>Monthly Growth Review</h1>
        <div style={S.subtitle}>
          Last refresh {fmtTime(lastRefreshAt)} · {totals.ok}/{totals.total} OK
          {totals.error > 0 ? ` · ${totals.error} error${totals.error === 1 ? "" : "s"}` : ""}
          {totals.loading > 0 ? ` · ${totals.loading} loading` : ""}
        </div>
      </div>
      <div style={S.headerRight}>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={S.select}
          aria-label="Reporting month"
        >
          {monthOptions().map((iso) => (
            <option key={iso} value={iso}>{fmtMonthIso(iso)}</option>
          ))}
        </select>
        <button type="button" onClick={onToggleLog} style={S.btnSecondary}>
          {logOpen ? "Hide log" : `Refresh log${totals.error > 0 ? ` (${totals.error})` : ""}`}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          style={S.btnPrimary}
          disabled={totals.loading > 0}
        >
          {totals.loading > 0 ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </header>
  );
}

function RefreshLog({ apiEntries, lastRefreshAt }) {
  return (
    <div style={S.logPanel} role="region" aria-label="Refresh log">
      <div style={S.logHeader}>
        Last refresh: {fmtTime(lastRefreshAt)} · {apiEntries.length} API call{apiEntries.length === 1 ? "" : "s"}
      </div>
      <div style={S.logTable}>
        <div style={{ ...S.logRow, ...S.logHeadRow }}>
          <span style={S.logCell}>Status</span>
          <span style={{ ...S.logCell, ...S.logName }}>Metric</span>
          <span style={S.logCell}>Rows</span>
          <span style={{ ...S.logCell, ...S.logErr }}>Error</span>
        </div>
        {apiEntries.map((e) => {
          const rows = e.api.data?.results?.length ?? 0;
          const status = e.api.loading ? "loading" : e.api.error ? "error" : "ok";
          const dot = status === "ok" ? "#10b981" : status === "error" ? "#ef4444" : "#f59e0b";
          return (
            <div key={e.label} style={S.logRow}>
              <span style={S.logCell}>
                <span style={{ ...S.dot, background: dot }} />
                <span style={S.logStatusText}>{status}</span>
              </span>
              <span style={{ ...S.logCell, ...S.logName }} title={e.label}>{e.label}</span>
              <span style={S.logCell}>{e.api.loading ? "…" : rows}</span>
              <span
                style={{ ...S.logCell, ...S.logErr }}
                title={e.api.error ? String(e.api.error?.message || e.api.error) : ""}
              >
                {e.api.error ? String(e.api.error?.message || e.api.error) : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionView({ title, metrics, onDeepDive }) {
  const visible = metrics.filter((m) => !m.api.error);
  return (
    <section style={S.section}>
      <div style={S.sectionHead}>
        <h2 style={S.sectionTitle}>{title}</h2>
        <div style={S.sectionMeta}>
          {visible.length}/{metrics.length} available
        </div>
      </div>
      {visible.length === 0 ? (
        <div style={S.empty}>
          All metrics in this section errored. See refresh log for details.
        </div>
      ) : (
        <div style={S.grid}>
          {visible.map((m) => (
            <MetricCard key={m.name} metric={m} onDeepDive={onDeepDive} />
          ))}
        </div>
      )}
    </section>
  );
}

function MetricCard({ metric, onDeepDive }) {
  const { api, name, format, insight, dashboard, sparkline, transform, note } = metric;
  const rows = useMemo(() => {
    const raw = api.data?.results || [];
    return transform ? transform(raw) : raw;
  }, [api.data, transform]);

  const lastVal = rows.length > 0 ? Number(rows[rows.length - 1][1]) : null;
  const prevVal = rows.length > 1 ? Number(rows[rows.length - 2][1]) : null;
  const mom = (lastVal != null && prevVal != null && prevVal !== 0)
    ? ((lastVal - prevVal) / Math.abs(prevVal)) * 100
    : null;
  const momColor = mom == null ? "#64748b" : mom >= 0 ? "#059669" : "#dc2626";

  const loading = api.loading && rows.length === 0;

  return (
    <button
      type="button"
      style={S.card}
      onClick={() => onDeepDive(name)}
      aria-label={`Deep dive into ${name}`}
    >
      <div style={S.cardLabel}>{name}</div>
      <div style={S.cardValue}>
        {loading ? "…" : lastVal == null ? "—" : format(lastVal)}
      </div>
      <div style={S.cardMeta}>
        {mom != null ? (
          <span style={{ color: momColor, fontWeight: 600 }}>
            {mom >= 0 ? "+" : ""}{mom.toFixed(1)}% MoM
          </span>
        ) : loading ? (
          <span>Loading…</span>
        ) : rows.length === 0 ? (
          <span>No matching events</span>
        ) : rows.length === 1 ? (
          <span>Only one month of data</span>
        ) : (
          <span>Prior month was zero</span>
        )}
        {note ? <span style={S.cardNote}> · {note}</span> : null}
      </div>
      {sparkline !== false && rows.length > 1 ? (
        <div style={S.cardSpark}>
          <Sparkline rows={rows} />
        </div>
      ) : (
        <div style={S.cardSparkPlaceholder} />
      )}
      <div style={S.cardLinks}>
        {dashboard ? (
          <a
            href={`https://us.posthog.com/project/2/dashboard/${dashboard}`}
            target="_blank"
            rel="noreferrer"
            style={S.link}
            onClick={(ev) => ev.stopPropagation()}
          >
            Dashboard ↗
          </a>
        ) : null}
        {insight ? (
          <a
            href={`https://us.posthog.com/project/2/insights/${insight}`}
            target="_blank"
            rel="noreferrer"
            style={S.link}
            onClick={(ev) => ev.stopPropagation()}
          >
            Insight ↗
          </a>
        ) : null}
      </div>
    </button>
  );
}

function Sparkline({ rows }) {
  const data = {
    labels: rows.map((r) => String(r[0])),
    datasets: [{
      data: rows.map((r) => Number(r[1])),
      borderColor: "rgba(99,102,241,1)",
      backgroundColor: "rgba(99,102,241,0.15)",
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      borderWidth: 1.5,
    }],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: { x: { display: false }, y: { display: false } },
    animation: false,
  };
  return <Line data={data} options={options} />;
}

function DeepDiveModal({ metric, month, onClose }) {
  const { api, name, format, insight, dashboard, query, transform } = metric;
  const [queryOpen, setQueryOpen] = useState(false);
  const rows = useMemo(() => {
    const raw = api.data?.results || [];
    return transform ? transform(raw) : raw;
  }, [api.data, transform]);

  return (
    <div style={S.modalBackdrop} onClick={onClose} role="presentation">
      <div
        style={S.modal}
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${name} deep dive`}
      >
        <header style={S.modalHeader}>
          <div style={{ minWidth: 0 }}>
            <div style={S.modalTitle}>{name}</div>
            <div style={S.modalSubtitle}>Reporting month: {fmtMonthIso(month)}</div>
          </div>
          <button type="button" onClick={onClose} style={S.btnSecondary} aria-label="Close">
            Close
          </button>
        </header>

        {api.error ? (
          <div style={S.errBox}>
            <strong>Refresh error</strong>
            <pre style={S.errPre}>{String(api.error?.message || api.error)}</pre>
          </div>
        ) : rows.length === 0 ? (
          <div style={S.empty}>No data for this period.</div>
        ) : (
          <>
            <div style={S.modalChart}>
              <Line
                data={{
                  labels: rows.map((r) => String(r[0])),
                  datasets: [{
                    label: name,
                    data: rows.map((r) => Number(r[1])),
                    borderColor: "rgba(99,102,241,1)",
                    backgroundColor: "rgba(99,102,241,0.15)",
                    fill: true,
                    tension: 0.25,
                    pointRadius: 3,
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    x: { grid: { display: false } },
                    y: { ticks: { callback: (v) => format(Number(v)) } },
                  },
                }}
              />
            </div>
            <table style={S.dataTable}>
              <thead>
                <tr>
                  <th style={S.th}>Month</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([mo, v]) => (
                  <tr key={String(mo)}>
                    <td style={S.td}>{String(mo)}</td>
                    <td style={{ ...S.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {format(Number(v))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div style={S.querySection}>
          <button
            type="button"
            onClick={() => setQueryOpen((o) => !o)}
            style={S.queryToggle}
          >
            {queryOpen ? "Hide HogQL" : "Show HogQL"}
          </button>
          {queryOpen ? <pre style={S.queryBox}>{query}</pre> : null}
        </div>

        <div style={S.modalFooter}>
          <div style={S.modalLinks}>
            {insight ? (
              <a
                href={`https://us.posthog.com/project/2/insights/${insight}`}
                target="_blank"
                rel="noreferrer"
                style={S.link}
              >
                Source insight ↗
              </a>
            ) : null}
            {dashboard ? (
              <a
                href={`https://us.posthog.com/project/2/dashboard/${dashboard}`}
                target="_blank"
                rel="noreferrer"
                style={S.link}
              >
                Dashboard ↗
              </a>
            ) : null}
          </div>
          <button type="button" onClick={() => metric.api.refetch()} style={S.btnSecondary}>
            Re-run query
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Metric helpers ──────────────────────────────────────────────────────────

function metric(def) {
  return {
    name: def.name,
    section: def.section,
    api: def.api,
    query: def.query,
    format: def.format,
    insight: def.insight ?? null,
    dashboard: def.dashboard ?? null,
    sparkline: def.sparkline !== false,
    transform: def.transform ?? null,
    note: def.note ?? null,
    queryLabel: def.queryLabel ?? null,
  };
}

function dedupeApiEntries(metrics) {
  const seen = new Map();
  for (const m of metrics) {
    if (seen.has(m.api)) continue;
    seen.set(m.api, { label: m.queryLabel || m.name, api: m.api });
  }
  return Array.from(seen.values());
}

// Picks one column out of a multi-column HogQL result, normalizes the month
// label, and reverses to ascending order (source queries ORDER BY month DESC).
function pickColAsc(idx) {
  return (rows) =>
    rows
      .slice()
      .reverse()
      .map((r) => [normalizeMonth(r[0]), Number(r[idx]) || 0]);
}

function normalizeMonth(v) {
  if (v == null) return "";
  const s = String(v);
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}`;
  return s;
}

function summarize(apiEntries) {
  let ok = 0, error = 0, loading = 0;
  for (const e of apiEntries) {
    if (e.api.loading) loading++;
    else if (e.api.error) error++;
    else ok++;
  }
  return { ok, error, loading, total: apiEntries.length };
}

// ─── HogQL ───────────────────────────────────────────────────────────────────

// HogQL queries — copied with anchor-parameterization from the source insights
// listed below. Comments above each query name the insight short_id so it's
// easy to cross-reference against the PostHog UI.
//
// Shared event set for PA activity (matches action 269059 "Any Product Analytics Event"):
const PA_EVENTS = "('chat with ai', 'insight saved', 'insight created', 'insight updated', 'mcp tool call', 'mcp_tool_call')";
// Same set minus 'insight updated' — what the activation insight (qBZKXLcn) and
// MAU insight (iGhZR9Kg) actually use:
const PA_EVENTS_CORE = "('chat with ai', 'insight saved', 'insight created', 'mcp tool call', 'mcp_tool_call')";
// PostHog-employee filter — every event-based insight excludes us.
const EXCLUDE_INTERNAL = "person.properties['email'] NOT ILIKE '%@posthog.com%'";

const Q = {
  // Revenue summary — insight Y2bqQQSZ.
  // Returns one row per month with all 8 revenue metrics + new_paying_orgs.
  // Backed by the prod Postgres invoice table (data warehouse).
  revenue(anchor) {
    const a = sanitizeIsoMonth(anchor);
    return (
      `WITH monthly_org_mrr AS (\n` +
      `    SELECT\n` +
      `        organization_id,\n` +
      `        toStartOfMonth(toDate(period_end)) AS month,\n` +
      `        SUM(JSONExtractFloat(mrr_per_product, 'product_analytics'))  AS pa_mrr,\n` +
      `        SUM(JSONExtractFloat(mrr_per_product, 'enhanced_persons'))   AS ep_mrr,\n` +
      `        SUM(JSONExtractFloat(mrr_per_product, 'group_analytics'))    AS ga_mrr,\n` +
      `        SUM(\n` +
      `            JSONExtractFloat(mrr_per_product, 'product_analytics') +\n` +
      `            JSONExtractFloat(mrr_per_product, 'enhanced_persons')  +\n` +
      `            JSONExtractFloat(mrr_per_product, 'group_analytics')\n` +
      `        ) AS combined_mrr\n` +
      `    FROM postgres.prod.invoice_with_annual\n` +
      `    WHERE type IN ('completed', 'annual')\n` +
      `    GROUP BY organization_id, month\n` +
      `),\n` +
      `first_paying_month AS (\n` +
      `    SELECT organization_id, MIN(month) AS first_month\n` +
      `    FROM monthly_org_mrr\n` +
      `    WHERE combined_mrr > 0\n` +
      `    GROUP BY organization_id\n` +
      `)\n` +
      `SELECT\n` +
      `    m.month,\n` +
      `    countIf(f.first_month = m.month AND m.combined_mrr > 0)    AS new_paying_orgs,\n` +
      `    countIf(m.combined_mrr > 0)                                AS total_paying_orgs,\n` +
      `    round(sumIf(m.pa_mrr, m.combined_mrr > 0), 2)              AS pa_mrr,\n` +
      `    countIf(m.pa_mrr > 0 AND m.combined_mrr > 0)               AS pa_paying_orgs,\n` +
      `    round(sumIf(m.ep_mrr, m.combined_mrr > 0), 2)              AS ep_mrr,\n` +
      `    countIf(m.ep_mrr > 0 AND m.combined_mrr > 0)               AS ep_paying_orgs,\n` +
      `    round(sumIf(m.ga_mrr, m.combined_mrr > 0), 2)              AS ga_mrr,\n` +
      `    countIf(m.ga_mrr > 0 AND m.combined_mrr > 0)               AS ga_paying_orgs,\n` +
      `    round(sumIf(m.combined_mrr, m.combined_mrr > 0), 2)        AS total_combined_mrr\n` +
      `FROM monthly_org_mrr m\n` +
      `LEFT JOIN first_paying_month f ON m.organization_id = f.organization_id\n` +
      `WHERE m.month >= toStartOfMonth(toDateTime('${a}')) - INTERVAL 11 MONTH\n` +
      `  AND m.month <= toStartOfMonth(toDateTime('${a}'))\n` +
      `GROUP BY m.month\n` +
      `ORDER BY m.month DESC\n` +
      `LIMIT 24`
    );
  },

  // Ingested Events — insight u1byeLof.
  // Wide row: total / person-profile / anon-only / anon%.
  ingestedEvents(anchor) {
    const a = sanitizeIsoMonth(anchor);
    return (
      `SELECT\n` +
      `    dateTrunc('month', toDateTime(ur.date, 'UTC')) AS month,\n` +
      `    sum(toInt(ur.org_usage_summary.events))                  AS total_events,\n` +
      `    sum(toInt(ur.org_usage_summary.enhanced_persons_events)) AS person_profiles_events,\n` +
      `    total_events - person_profiles_events                    AS anon_only_events,\n` +
      `    round(if(total_events > 0, anon_only_events / total_events * 100, 0), 1) AS anon_pct\n` +
      `FROM prod_postgres_billing_usagereport ur\n` +
      `WHERE ur.date >= toStartOfMonth(toDateTime('${a}')) - INTERVAL 11 MONTH\n` +
      `  AND ur.date < toStartOfMonth(toDateTime('${a}')) + INTERVAL 1 MONTH\n` +
      `GROUP BY month\n` +
      `ORDER BY month DESC`
    );
  },

  // Activation Rate — insight qBZKXLcn.
  // ≥4 unique active days of any PA event in the first 14 days from first_day.
  activation(anchor) {
    const a = sanitizeIsoMonth(anchor);
    return (
      `WITH lifetime_first AS (\n` +
      `    SELECT person_id, min(toDate(timestamp)) AS first_day\n` +
      `    FROM events\n` +
      `    WHERE event IN ${PA_EVENTS_CORE}\n` +
      `    GROUP BY person_id\n` +
      `),\n` +
      `intent_event_filter AS (\n` +
      `    SELECT person_id, first_day, toStartOfMonth(first_day) AS cohort_month\n` +
      `    FROM lifetime_first\n` +
      `    WHERE first_day >= toStartOfMonth(addMonths(toDateTime('${a}'), -11))\n` +
      `      AND first_day <= addDays(addMonths(toDateTime('${a}'), 1), -14)\n` +
      `),\n` +
      `activation_window AS (\n` +
      `    SELECT e.person_id, uniqExact(toDate(e.timestamp)) AS unique_active_days\n` +
      `    FROM events e\n` +
      `    JOIN intent_event_filter i ON e.person_id = i.person_id\n` +
      `    WHERE e.event IN ${PA_EVENTS_CORE}\n` +
      `      AND toDate(e.timestamp) >= i.first_day\n` +
      `      AND toDate(e.timestamp) < addDays(i.first_day, 14)\n` +
      `    GROUP BY e.person_id\n` +
      `),\n` +
      `members AS (\n` +
      `    SELECT i.person_id, i.cohort_month,\n` +
      `           coalesce(a.unique_active_days, 0) AS unique_active_days\n` +
      `    FROM intent_event_filter i\n` +
      `    LEFT JOIN activation_window a ON i.person_id = a.person_id\n` +
      `)\n` +
      `SELECT\n` +
      `    formatDateTime(cohort_month, '%Y-%m')                       AS cohort_month_label,\n` +
      `    count()                                                     AS intent_count,\n` +
      `    countIf(unique_active_days >= 4)                            AS activated_count,\n` +
      `    round(countIf(unique_active_days >= 4) / count() * 100, 1)  AS activation_pct\n` +
      `FROM members\n` +
      `GROUP BY cohort_month\n` +
      `ORDER BY cohort_month DESC`
    );
  },

  // New Org Sign-ups — insight gpAfsMkW.
  newOrgs(anchor) {
    const a = sanitizeIsoMonth(anchor);
    return (
      `SELECT\n` +
      `    toStartOfMonth(timestamp) AS month,\n` +
      `    uniqExact(\`$group_0\`) AS unique_orgs\n` +
      `FROM events\n` +
      `WHERE event = 'user signed up'\n` +
      `  AND properties.is_organization_first_user = 'true'\n` +
      `  AND timestamp >= toStartOfMonth(toDateTime('${a}')) - INTERVAL 11 MONTH\n` +
      `  AND timestamp <  toStartOfMonth(toDateTime('${a}')) + INTERVAL 1 MONTH\n` +
      `  AND ${EXCLUDE_INTERNAL}\n` +
      `GROUP BY month\n` +
      `ORDER BY month DESC\n` +
      `LIMIT 100`
    );
  },

  // First Team Event Ingested — insight agN6bTfR.
  firstTeamEvent(anchor) {
    const a = sanitizeIsoMonth(anchor);
    return (
      `SELECT\n` +
      `    toStartOfMonth(timestamp) AS month,\n` +
      `    uniqExact(\`$group_0\`) AS unique_orgs\n` +
      `FROM events\n` +
      `WHERE event IN ('first team event ingested')\n` +
      `  AND timestamp >= toStartOfMonth(toDateTime('${a}')) - INTERVAL 11 MONTH\n` +
      `  AND timestamp <  toStartOfMonth(toDateTime('${a}')) + INTERVAL 1 MONTH\n` +
      `  AND ${EXCLUDE_INTERNAL}\n` +
      `GROUP BY month\n` +
      `ORDER BY month DESC\n` +
      `LIMIT 100`
    );
  },

  // Monthly Active Users — insight iGhZR9Kg.
  mau(anchor) {
    return Q._distinctUsersInEvents(anchor, PA_EVENTS_CORE);
  },

  // MCP Tool Call (unique users) — insight Cfqb3uCT.
  mcpUsers(anchor) {
    return Q._distinctUsersInEvents(anchor, "('mcp tool call', 'mcp_tool_call')");
  },

  // PostHog AI Chats (unique users) — insight lRgF8sWc.
  // Filters to conversations mentioning insight/dashboard in prompt or response.
  aiChatUsers(anchor) {
    const a = sanitizeIsoMonth(anchor);
    return (
      `SELECT\n` +
      `    toStartOfMonth(timestamp) AS month,\n` +
      `    uniqExact(person_id) AS unique_users\n` +
      `FROM events\n` +
      `WHERE event IN ('chat with ai')\n` +
      `  AND timestamp >= toStartOfMonth(toDateTime('${a}')) - INTERVAL 11 MONTH\n` +
      `  AND timestamp <  toStartOfMonth(toDateTime('${a}')) + INTERVAL 1 MONTH\n` +
      `  AND ${EXCLUDE_INTERNAL}\n` +
      `  AND (\n` +
      `      properties['prompt'] ILIKE '%insight%'\n` +
      `      OR properties['prompt'] ILIKE '%dashboard%'\n` +
      `      OR properties['response'] ILIKE '%insight%'\n` +
      `      OR properties['response'] ILIKE '%dashboard%'\n` +
      `  )\n` +
      `GROUP BY month\n` +
      `ORDER BY month DESC\n` +
      `LIMIT 100`
    );
  },

  // Insight Saves (unique users) — insight QZQRicAn.
  insightSaveUsers(anchor) {
    return Q._distinctUsersInEvents(anchor, "('insight saved')");
  },

  // N-month retention — approximation of insight 9iodbUXC.
  // Source insight uses a recurring RetentionQuery (action 269059, 7 intervals)
  // which can't be expressed via api.query. We compute the simpler
  // "% of N-month-ago cohort active in anchor month" version using the same
  // event set as the retention action.
  retention(anchor, monthsAgo) {
    const a = sanitizeIsoMonth(anchor);
    const N = Math.max(1, Math.floor(Number(monthsAgo) || 1));
    return (
      `SELECT '${a.slice(0, 7)}' AS mo,\n` +
      `       if(c > 0, round(100.0 * r / c, 1), 0) AS pct\n` +
      `FROM (\n` +
      `    SELECT countIf(in_cohort = 1) AS c,\n` +
      `           countIf(in_cohort = 1 AND in_current = 1) AS r\n` +
      `    FROM (\n` +
      `        SELECT person_id,\n` +
      `               max(if(toStartOfMonth(timestamp) = toStartOfMonth(addMonths(toDateTime('${a}'), -${N})), 1, 0)) AS in_cohort,\n` +
      `               max(if(toStartOfMonth(timestamp) = toStartOfMonth(toDateTime('${a}')), 1, 0))               AS in_current\n` +
      `        FROM events\n` +
      `        WHERE event IN ${PA_EVENTS}\n` +
      `          AND timestamp >= addMonths(toDateTime('${a}'), -${N + 1})\n` +
      `          AND timestamp <  addMonths(toDateTime('${a}'), 1)\n` +
      `          AND ${EXCLUDE_INTERNAL}\n` +
      `        GROUP BY person_id\n` +
      `    )\n` +
      `)`
    );
  },

  // Shared body for the simple "distinct users per month with these events" queries.
  _distinctUsersInEvents(anchor, eventTuple) {
    const a = sanitizeIsoMonth(anchor);
    return (
      `SELECT\n` +
      `    toStartOfMonth(timestamp) AS month,\n` +
      `    uniqExact(person_id) AS unique_users\n` +
      `FROM events\n` +
      `WHERE event IN ${eventTuple}\n` +
      `  AND timestamp >= toStartOfMonth(toDateTime('${a}')) - INTERVAL 11 MONTH\n` +
      `  AND timestamp <  toStartOfMonth(toDateTime('${a}')) + INTERVAL 1 MONTH\n` +
      `  AND ${EXCLUDE_INTERNAL}\n` +
      `GROUP BY month\n` +
      `ORDER BY month DESC\n` +
      `LIMIT 100`
    );
  },
};

function sanitizeIsoMonth(iso) {
  // We interpolate this into HogQL — reject anything that isn't YYYY-MM-01.
  return /^\d{4}-\d{2}-01$/.test(iso) ? iso : defaultMonthIso();
}

// ─── Date / number helpers ───────────────────────────────────────────────────

function defaultMonthIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function monthOptions() {
  const opts = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    opts.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
  }
  return opts;
}

function fmtMonthIso(iso) {
  if (typeof iso !== "string") return String(iso);
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m[2]) - 1]} ${m[1]}`;
}

function daysInMonthIso(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso));
  if (!m) return 30;
  return new Date(Number(m[1]), Number(m[2]), 0).getDate();
}

function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtInt(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtCurrency(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtPercent(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const S = {
  app: {
    fontFamily: "system-ui",
    color: "#0f172a",
    background: "#f8fafc",
    minHeight: "100%",
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    fontSize: 13,
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    padding: "12px 14px",
    background: "#fff",
    borderRadius: 10,
    border: "1px solid #e2e8f0",
  },
  headerLeft: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  headerRight: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" },
  title: { margin: 0, fontSize: 18, fontWeight: 700 },
  subtitle: { fontSize: 12, color: "#64748b" },
  select: {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid #e2e8f0",
    background: "#fff",
    fontSize: 12,
    fontFamily: "inherit",
  },
  btnPrimary: {
    padding: "6px 14px",
    borderRadius: 6,
    border: "1px solid #4f46e5",
    background: "#4f46e5",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  },
  btnSecondary: {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid #e2e8f0",
    background: "#fff",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
    color: "#0f172a",
  },
  sectionsWrap: { display: "flex", flexDirection: "column", gap: 12 },
  section: {
    background: "#fff",
    borderRadius: 10,
    border: "1px solid #e2e8f0",
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  sectionHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 8,
  },
  sectionTitle: { margin: 0, fontSize: 15, fontWeight: 600 },
  sectionMeta: { fontSize: 11, color: "#64748b" },
  grid: {
    display: "grid",
    gap: 8,
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  },
  card: {
    textAlign: "left",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: 12,
    background: "#fafbff",
    cursor: "pointer",
    fontFamily: "inherit",
    color: "inherit",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minHeight: 130,
  },
  cardLabel: {
    fontSize: 11,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontWeight: 600,
  },
  cardValue: { fontSize: 22, fontWeight: 700, color: "#0f172a", lineHeight: 1.1 },
  cardMeta: { fontSize: 11, color: "#475569" },
  cardNote: { color: "#94a3b8" },
  cardSpark: { height: 32, marginTop: 4 },
  cardSparkPlaceholder: { height: 4 },
  cardLinks: { display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" },
  link: { color: "#4f46e5", fontSize: 11, fontWeight: 500, textDecoration: "none" },
  empty: {
    background: "#f1f5f9",
    color: "#64748b",
    padding: 10,
    borderRadius: 6,
    fontSize: 12,
    textAlign: "center",
  },

  // Log panel
  logPanel: {
    background: "#0f172a",
    color: "#e2e8f0",
    borderRadius: 10,
    border: "1px solid #1e293b",
    padding: 12,
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
    fontSize: 11,
    overflowX: "auto",
  },
  logHeader: { marginBottom: 8, color: "#94a3b8" },
  logTable: { display: "flex", flexDirection: "column", gap: 0 },
  logRow: {
    display: "grid",
    gridTemplateColumns: "100px 1.4fr 60px 2fr",
    gap: 8,
    padding: "4px 0",
    borderBottom: "1px solid #1e293b",
    alignItems: "center",
  },
  logHeadRow: { color: "#94a3b8", fontWeight: 600, borderBottom: "1px solid #334155" },
  logCell: { display: "flex", alignItems: "center", gap: 4, minWidth: 0 },
  logName: { color: "#f8fafc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" },
  logStatusText: { textTransform: "uppercase", fontSize: 10, letterSpacing: 0.5 },
  logErr: { color: "#fecaca", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  dot: { display: "inline-block", width: 8, height: 8, borderRadius: 4, flexShrink: 0 },

  // Modal
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 50,
  },
  modal: {
    background: "#fff",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    padding: 16,
    width: "100%",
    maxWidth: 640,
    maxHeight: "90vh",
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  modalTitle: { fontSize: 16, fontWeight: 700 },
  modalSubtitle: { fontSize: 11, color: "#64748b", marginTop: 2 },
  modalChart: { height: 220 },
  modalFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  modalLinks: { display: "flex", gap: 12, flexWrap: "wrap" },
  dataTable: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: {
    textAlign: "left",
    padding: "6px 8px",
    borderBottom: "1px solid #e2e8f0",
    color: "#64748b",
    fontWeight: 600,
  },
  td: { padding: "6px 8px", borderBottom: "1px solid #f1f5f9" },
  errBox: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    padding: 10,
    borderRadius: 8,
    color: "#991b1b",
  },
  errPre: {
    whiteSpace: "pre-wrap",
    margin: "6px 0 0",
    fontSize: 11,
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
  },
  querySection: { display: "flex", flexDirection: "column", gap: 6 },
  queryToggle: {
    alignSelf: "flex-start",
    padding: "4px 8px",
    borderRadius: 4,
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    fontSize: 11,
    fontFamily: "inherit",
    cursor: "pointer",
    color: "#475569",
  },
  queryBox: {
    background: "#0f172a",
    color: "#e2e8f0",
    padding: 10,
    borderRadius: 6,
    fontSize: 11,
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    margin: 0,
  },
};
