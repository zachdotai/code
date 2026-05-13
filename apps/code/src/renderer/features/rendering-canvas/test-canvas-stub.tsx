// Edit this file freely — it's the source rendered by the "Test canvas" sidebar button.
// Runs inside a sandboxed iframe with React 19, Chart.js, and an `api` bridge.
// Available globals: React, useState, useEffect, useCallback, useMemo, useRef,
// api, useApi, Chart, Chartjs, Line, Bar, Pie, Doughnut, Radar, PolarArea, Bubble, Scatter.
//
// `api.query(hogql)` returns { columns, results } where results is unknown[][].
// `useApi("query", [hogql], deps)` is the hook form.

// biome-ignore lint/correctness/noUnusedVariables: consumed as raw text by the canvas iframe runtime
function App() {
  const dau = useApi(
    "query",
    [
      "SELECT toDate(timestamp) AS day, count(DISTINCT distinct_id) AS dau " +
        "FROM events WHERE timestamp >= now() - INTERVAL 30 DAY " +
        "GROUP BY day ORDER BY day",
    ],
    [],
  );

  const topEvents = useApi(
    "query",
    [
      "SELECT event, count() AS c FROM events " +
        "WHERE timestamp >= now() - INTERVAL 7 DAY " +
        "GROUP BY event ORDER BY c DESC LIMIT 8",
    ],
    [],
  );

  const totals = useApi(
    "query",
    [
      "SELECT " +
        "  count(DISTINCT if(timestamp >= now() - INTERVAL 7 DAY, distinct_id, NULL)) AS wau, " +
        "  count(DISTINCT if(timestamp >= now() - INTERVAL 14 DAY AND timestamp < now() - INTERVAL 7 DAY, distinct_id, NULL)) AS wau_prev, " +
        "  count(if(timestamp >= now() - INTERVAL 30 DAY, 1, NULL)) AS events_30d " +
        "FROM events WHERE timestamp >= now() - INTERVAL 14 DAY",
    ],
    [],
  );

  const loading = dau.loading || topEvents.loading || totals.loading;
  const anyError = dau.error || topEvents.error || totals.error;

  const refetchAll = () => {
    dau.refetch();
    topEvents.refetch();
    totals.refetch();
  };

  if (anyError) {
    return (
      <div style={S.page}>
        <header style={S.header}>
          <h2 style={S.title}>Product analytics — growth review</h2>
          <button type="button" onClick={refetchAll} style={S.btn}>
            Retry
          </button>
        </header>
        <pre style={S.error}>{String(anyError?.message || anyError)}</pre>
      </div>
    );
  }

  const dauRows = dau.data?.results || [];
  const topRows = topEvents.data?.results || [];
  const totalsRow = totals.data?.results?.[0] || [0, 0, 0];
  const wau = Number(totalsRow[0]) || 0;
  const wauPrev = Number(totalsRow[1]) || 0;
  const events30d = Number(totalsRow[2]) || 0;
  const wow = wauPrev > 0 ? ((wau - wauPrev) / wauPrev) * 100 : null;
  const wowColor = wow == null ? "#64748b" : wow >= 0 ? "#059669" : "#dc2626";
  const wowSign =
    wow == null ? "—" : `${(wow >= 0 ? "+" : "") + wow.toFixed(1)}%`;

  return (
    <div style={S.page}>
      <header style={S.header}>
        <div>
          <h2 style={S.title}>Product analytics — growth review</h2>
          <p style={S.subtitle}>
            Last 30 days · live HogQL via the canvas API bridge
          </p>
        </div>
        <button
          type="button"
          onClick={refetchAll}
          style={S.btn}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <section style={S.kpiRow}>
        <Kpi
          label="Weekly active users"
          value={fmtInt(wau)}
          hint="last 7 days"
        />
        <Kpi
          label="WoW change"
          value={wowSign}
          hint={`vs. ${fmtInt(wauPrev)} prior week`}
          valueColor={wowColor}
        />
        <Kpi
          label="Events ingested"
          value={fmtInt(events30d)}
          hint="last 30 days"
        />
      </section>

      <section style={S.card}>
        <h3 style={S.cardTitle}>Daily active users</h3>
        <div style={{ height: 220 }}>
          {dauRows.length === 0 ? (
            <p style={S.empty}>No events in the last 30 days.</p>
          ) : (
            <Line
              data={{
                labels: dauRows.map((r) => String(r[0])),
                datasets: [
                  {
                    label: "DAU",
                    data: dauRows.map((r) => Number(r[1])),
                    borderColor: "rgba(99,102,241,1)",
                    backgroundColor: "rgba(99,102,241,0.15)",
                    fill: true,
                    tension: 0.25,
                    pointRadius: 0,
                  },
                ],
              }}
              options={chartOpts()}
            />
          )}
        </div>
      </section>

      <section style={S.card}>
        <h3 style={S.cardTitle}>Top events (last 7 days)</h3>
        <div style={{ height: 220 }}>
          {topRows.length === 0 ? (
            <p style={S.empty}>No events captured yet.</p>
          ) : (
            <Bar
              data={{
                labels: topRows.map((r) => String(r[0])),
                datasets: [
                  {
                    label: "Count",
                    data: topRows.map((r) => Number(r[1])),
                    backgroundColor: "rgba(16,185,129,0.7)",
                  },
                ],
              }}
              options={{ ...chartOpts(), indexAxis: "y" }}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, hint, valueColor }) {
  return (
    <div style={S.kpi}>
      <div style={S.kpiLabel}>{label}</div>
      <div style={{ ...S.kpiValue, color: valueColor || "#0f172a" }}>
        {value}
      </div>
      <div style={S.kpiHint}>{hint}</div>
    </div>
  );
}

function fmtInt(n) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function chartOpts() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      y: { grid: { color: "rgba(0,0,0,0.05)" }, ticks: { font: { size: 10 } } },
    },
  };
}

const S = {
  page: {
    fontFamily: "system-ui",
    padding: 16,
    color: "#0f172a",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  title: { margin: 0, fontSize: 18, fontWeight: 600 },
  subtitle: { margin: "2px 0 0", fontSize: 12, color: "#64748b" },
  btn: {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid #e2e8f0",
    background: "#fff",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  },
  kpiRow: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 },
  kpi: {
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: 12,
    background: "#fff",
  },
  kpiLabel: {
    fontSize: 11,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  kpiValue: { fontSize: 22, fontWeight: 600, marginTop: 4 },
  kpiHint: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  card: {
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: 12,
    background: "#fff",
  },
  cardTitle: {
    margin: "0 0 8px",
    fontSize: 13,
    fontWeight: 600,
    color: "#334155",
  },
  empty: { color: "#94a3b8", fontSize: 13, margin: 0 },
  error: {
    color: "#b91c1c",
    padding: 12,
    background: "#fef2f2",
    borderRadius: 6,
    fontSize: 12,
    whiteSpace: "pre-wrap",
  },
};
