// @ts-nocheck — file is consumed as raw text via `?raw` and executed inside an
// iframe with React hooks, `api`, `useApi`, Chart.js components, and the PostHog
// canvas primitives (`PageHeader`, `Section`, `KpiRow`, `Kpi`, `EmptyState`,
// `ErrorState`, `chartTheme`, `tokens`) injected as locals by the runtime
// (see ../runtime.ts). TypeScript can't see those globals, so type-checking
// this file produces noise without value.
//
// ─── Activity overview canvas ───────────────────────────────────────────────
// 3 KPIs (totals + per-user ratio), a daily-events line chart, and a top-events
// bar chart. All metrics are live HogQL via `useApi("query", [hogql])` so the
// Refresh button can re-run them. The refresh log surfaces ok / loading /
// error for each unique query, and any errored card is hidden from the layout
// (the error still lands in the log).

// biome-ignore lint/correctness/noUnusedVariables: consumed as raw text by the canvas iframe runtime
function App() {
  const [lastRefreshAt, setLastRefreshAt] = useState(() => Date.now());
  const [logOpen, setLogOpen] = useState(false);

  // ─── Queries (one useApi per unique underlying query) ─────────────────────

  // Totals over the last 7 days — single query returns both count() and
  // count(DISTINCT person_id), so the "Total events", "Distinct users", and
  // derived "Avg events per user" KPIs all share one roundtrip.
  const totalsHogQL = useMemo(
    () =>
      `SELECT count() AS total_events,\n` +
      `       count(DISTINCT person_id) AS distinct_users\n` +
      `FROM events\n` +
      `WHERE timestamp >= now() - INTERVAL 7 DAY\n` +
      `  AND timestamp <  now()`,
    [],
  );

  // Events per day over the last 14 days for the line chart.
  const dailyHogQL = useMemo(
    () =>
      `SELECT toDate(timestamp) AS day,\n` +
      `       count() AS events\n` +
      `FROM events\n` +
      `WHERE timestamp >= now() - INTERVAL 14 DAY\n` +
      `  AND timestamp <  now()\n` +
      `GROUP BY day\n` +
      `ORDER BY day ASC`,
    [],
  );

  // Top 10 events by volume over the last 7 days for the bar chart.
  const topEventsHogQL = useMemo(
    () =>
      `SELECT event,\n` +
      `       count() AS volume\n` +
      `FROM events\n` +
      `WHERE timestamp >= now() - INTERVAL 7 DAY\n` +
      `  AND timestamp <  now()\n` +
      `GROUP BY event\n` +
      `ORDER BY volume DESC\n` +
      `LIMIT 10`,
    [],
  );

  const totals = useApi("query", [totalsHogQL], [totalsHogQL]);
  const daily = useApi("query", [dailyHogQL], [dailyHogQL]);
  const topEvents = useApi("query", [topEventsHogQL], [topEventsHogQL]);

  // Registry of every API call, used by the refresh log + Refresh button.
  const apiEntries = useMemo(
    () => [
      { label: "Activity totals (events + users)", api: totals },
      { label: "Daily events (14d)", api: daily },
      { label: "Top events (7d)", api: topEvents },
    ],
    [totals, daily, topEvents],
  );

  const refreshAll = useCallback(() => {
    for (const e of apiEntries) {
      e.api.refetch();
    }
    setLastRefreshAt(Date.now());
  }, [apiEntries]);

  const logSummary = useMemo(() => {
    let ok = 0;
    let loading = 0;
    let error = 0;
    for (const e of apiEntries) {
      if (e.api.loading) loading++;
      else if (e.api.error) error++;
      else ok++;
    }
    return { ok, loading, error, total: apiEntries.length };
  }, [apiEntries]);

  // ─── Derive KPI values from the shared totals query ───────────────────────

  const totalsRow = totals.data?.results?.[0];
  const totalEvents = totalsRow ? Number(totalsRow[0]) || 0 : null;
  const distinctUsers = totalsRow ? Number(totalsRow[1]) || 0 : null;
  const avgPerUser =
    totalEvents != null && distinctUsers != null && distinctUsers > 0
      ? totalEvents / distinctUsers
      : null;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <PageHeader
        title="Activity overview"
        subtitle="Last 7–14 days · live HogQL"
        action={
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setLogOpen((o) => !o)}
              style={{
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 500,
                color: "var(--gray-12)",
                background: "var(--gray-2)",
                border: "1px solid var(--gray-5)",
                borderRadius: "var(--radius-2)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {logOpen
                ? "Hide log"
                : `Refresh log${logSummary.error > 0 ? ` (${logSummary.error})` : ""}`}
            </button>
            <button
              type="button"
              onClick={refreshAll}
              disabled={logSummary.loading > 0}
              style={{
                padding: "6px 14px",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--gray-1)",
                background: "var(--orange-9)",
                border: "1px solid var(--orange-9)",
                borderRadius: "var(--radius-2)",
                cursor: logSummary.loading > 0 ? "default" : "pointer",
                opacity: logSummary.loading > 0 ? 0.7 : 1,
                fontFamily: "inherit",
              }}
            >
              {logSummary.loading > 0 ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        }
      />

      {logOpen ? (
        <RefreshLog
          entries={apiEntries}
          lastRefreshAt={lastRefreshAt}
          summary={logSummary}
        />
      ) : null}

      <KpiBlock
        totalsApi={totals}
        totalEvents={totalEvents}
        distinctUsers={distinctUsers}
        avgPerUser={avgPerUser}
      />

      <Section title="Daily events">
        <DailyEventsChart api={daily} />
      </Section>

      <Section title="Top events">
        <TopEventsChart api={topEvents} />
      </Section>
    </div>
  );
}

// ─── KPI block ───────────────────────────────────────────────────────────────
// "Hide errored cards" — if the totals query errors, the whole row disappears
// (all three KPIs share that query). The error still surfaces in the refresh log.

function KpiBlock({ totalsApi, totalEvents, distinctUsers, avgPerUser }) {
  if (totalsApi.error) return null;
  const loading = totalsApi.loading && !totalsApi.data;
  return (
    <KpiRow>
      <Kpi
        label="Total events"
        value={loading ? "…" : fmtInt(totalEvents)}
        hint="Last 7 days"
      />
      <Kpi
        label="Distinct users"
        value={loading ? "…" : fmtInt(distinctUsers)}
        hint="Last 7 days"
      />
      <Kpi
        label="Avg events per user"
        value={loading ? "…" : fmtDecimal(avgPerUser)}
        hint="Total ÷ Distinct"
        tone="brand"
      />
    </KpiRow>
  );
}

// ─── Daily events line chart ─────────────────────────────────────────────────

function DailyEventsChart({ api }) {
  if (api.error) return null;
  const rows = api.data?.results || [];
  const loading = api.loading && rows.length === 0;

  if (loading) {
    return (
      <div
        style={{
          height: 220,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--gray-9)" }}>Loading…</span>
      </div>
    );
  }
  if (rows.length === 0)
    return <EmptyState>No events in the last 14 days.</EmptyState>;

  const labels = rows.map((r) => String(r[0]));
  const values = rows.map((r) => Number(r[1]) || 0);
  const data = {
    labels,
    datasets: [
      {
        label: "Events",
        data: values,
        borderColor: tokens["--orange-9"],
        backgroundColor: tokens["--orange-3"],
        fill: true,
        tension: 0.25,
        pointRadius: 2,
        borderWidth: 2,
      },
    ],
  };
  return (
    <div style={{ height: 220, opacity: api.loading ? 0.6 : 1 }}>
      <Line
        data={data}
        options={chartTheme({ plugins: { legend: { display: false } } })}
      />
    </div>
  );
}

// ─── Top events bar chart (horizontal) ───────────────────────────────────────

function TopEventsChart({ api }) {
  if (api.error) return null;
  const rows = api.data?.results || [];
  const loading = api.loading && rows.length === 0;

  if (loading) {
    return (
      <div
        style={{
          height: 240,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--gray-9)" }}>Loading…</span>
      </div>
    );
  }
  if (rows.length === 0)
    return <EmptyState>No events in the last 7 days.</EmptyState>;

  const labels = rows.map((r) => String(r[0]));
  const values = rows.map((r) => Number(r[1]) || 0);
  const data = {
    labels,
    datasets: [
      {
        label: "Volume",
        data: values,
        backgroundColor: tokens["--orange-9"],
        borderColor: tokens["--orange-9"],
        borderWidth: 0,
      },
    ],
  };
  return (
    <div style={{ height: 240, opacity: api.loading ? 0.6 : 1 }}>
      <Bar
        data={data}
        options={chartTheme({
          indexAxis: "y",
          plugins: { legend: { display: false } },
        })}
      />
    </div>
  );
}

// ─── Refresh log ─────────────────────────────────────────────────────────────

function RefreshLog({ entries, lastRefreshAt, summary }) {
  return (
    <section
      aria-label="Refresh log"
      style={{
        background: "var(--gray-2)",
        border: "1px solid var(--gray-5)",
        borderRadius: "var(--radius-3)",
        padding: 12,
        fontFamily:
          '"Berkeley Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
        fontSize: 11,
        color: "var(--gray-11)",
      }}
    >
      <div style={{ color: "var(--gray-9)", marginBottom: 8 }}>
        Last refresh: {fmtTime(lastRefreshAt)} · {summary.ok}/{summary.total} OK
        {summary.error > 0
          ? ` · ${summary.error} error${summary.error === 1 ? "" : "s"}`
          : ""}
        {summary.loading > 0 ? ` · ${summary.loading} loading` : ""}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        <LogRow
          status="header"
          label="Query"
          rows="Rows"
          message="Error"
          isHeader
        />
        {entries.map((e) => {
          const status = e.api.loading
            ? "loading"
            : e.api.error
              ? "error"
              : "ok";
          const rowCount = e.api.loading
            ? "…"
            : String(e.api.data?.results?.length ?? 0);
          const message = e.api.error
            ? String(e.api.error?.message || e.api.error)
            : "";
          return (
            <LogRow
              key={e.label}
              status={status}
              label={e.label}
              rows={rowCount}
              message={message}
            />
          );
        })}
      </div>
    </section>
  );
}

function LogRow({ status, label, rows, message, isHeader }) {
  const dotColor =
    status === "ok"
      ? "var(--green-11)"
      : status === "error"
        ? "var(--red-11)"
        : status === "loading"
          ? "var(--yellow-11)"
          : "var(--gray-7)";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "90px 1.4fr 60px 2fr",
        gap: 8,
        padding: "4px 0",
        borderBottom: "1px solid var(--gray-5)",
        alignItems: "center",
        color: isHeader ? "var(--gray-9)" : "var(--gray-11)",
        fontWeight: isHeader ? 600 : 400,
      }}
    >
      <span
        style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}
      >
        {isHeader ? null : (
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 4,
              background: dotColor,
              flexShrink: 0,
            }}
          />
        )}
        <span
          style={{
            textTransform: "uppercase",
            fontSize: 10,
            letterSpacing: 0.5,
          }}
        >
          {isHeader ? "Status" : status}
        </span>
      </span>
      <span
        title={label}
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: isHeader ? "var(--gray-9)" : "var(--gray-12)",
        }}
      >
        {label}
      </span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{rows}</span>
      <span
        title={message}
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: isHeader ? "var(--gray-9)" : "var(--red-11)",
        }}
      >
        {message}
      </span>
    </div>
  );
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function fmtInt(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtDecimal(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
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
