// Primitives demo — exercises the canvas runtime's built-in PostHog primitives
// (PageHeader, KpiRow, Kpi, Section, EmptyState, ErrorState, chartTheme,
// tokens) so we can validate the full API path: POST → backend validation →
// DB → getRenderingCanvas → <RenderingCanvas> → iframe runtime.
//
// Available globals: React, useState, useEffect, useCallback, useMemo, useRef,
// api, useApi, Chart, Chartjs, Line, Bar, Pie, Doughnut, Radar, PolarArea,
// Bubble, Scatter, PageHeader, Section, KpiRow, Kpi, EmptyState, ErrorState,
// chartTheme, tokens.

// biome-ignore lint/correctness/noUnusedVariables: consumed as raw text by the canvas iframe runtime
function App() {
  const top = useApi(
    "query",
    [
      "SELECT properties.$lib AS sdk, count() AS events FROM events " +
        "WHERE timestamp >= now() - INTERVAL 7 DAY " +
        "  AND properties.$lib IS NOT NULL AND properties.$lib != '' " +
        "GROUP BY sdk ORDER BY events DESC LIMIT 6",
    ],
    [],
  );

  if (top.error) {
    return <ErrorState>{String(top.error.message || top.error)}</ErrorState>;
  }

  const rows = (top.data?.results || []).map((r) => ({
    sdk: String(r[0]),
    events: Number(r[1]) || 0,
  }));
  const totalEvents = rows.reduce((s, r) => s + r.events, 0);
  const topSdk = rows[0];

  return (
    <>
      <PageHeader
        title="Primitives demo"
        subtitle="Loaded from REST · uses tokens + primitives"
        action={
          <button
            type="button"
            onClick={top.refetch}
            disabled={top.loading}
            style={{
              padding: "6px 12px",
              borderRadius: "var(--radius-2, 4px)",
              border: "1px solid var(--gray-5)",
              background: "var(--gray-1)",
              color: "var(--gray-12)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {top.loading ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      <KpiRow>
        <Kpi
          label="Total events"
          value={totalEvents.toLocaleString()}
          hint="last 7 days"
          tone="brand"
        />
        <Kpi
          label="Top SDK"
          value={topSdk?.sdk || "—"}
          hint={topSdk ? `${topSdk.events.toLocaleString()} events` : "no data"}
        />
        <Kpi
          label="Distinct SDKs"
          value={String(rows.length)}
          hint="reporting in window"
          tone={rows.length > 0 ? "positive" : "negative"}
        />
      </KpiRow>

      <Section title="Events by SDK">
        {rows.length === 0 ? (
          <EmptyState>No SDK events in the last 7 days.</EmptyState>
        ) : (
          <div style={{ height: 220 }}>
            <Bar
              data={{
                labels: rows.map((r) => r.sdk),
                datasets: [
                  {
                    label: "Events",
                    data: rows.map((r) => r.events),
                    backgroundColor: tokens["--orange-9"],
                  },
                ],
              }}
              options={chartTheme({ indexAxis: "y" })}
            />
          </div>
        )}
      </Section>

      <p style={{ margin: 0, fontSize: 11, color: "var(--gray-9)" }}>
        Tokens injected from the host — flip the app theme to verify the iframe
        palette tracks it.
      </p>
    </>
  );
}
