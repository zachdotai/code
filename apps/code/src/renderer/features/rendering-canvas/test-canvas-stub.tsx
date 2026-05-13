// Edit this file freely — it's the source rendered by the "Test canvas" sidebar button.
// It runs inside a sandboxed iframe with React 19, Chart.js, and an `api` bridge.
// Available globals (no imports needed): React, useState, useEffect, useCallback,
// useMemo, useRef, api, useApi, Chart, Line, Bar, Pie, Doughnut, Radar,
// PolarArea, Bubble, Scatter.
// You must export a component named `App` (or default).

function _App() {
  const [count, setCount] = useState(0);

  const data = {
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    datasets: [
      {
        label: "Clicks",
        data: [12, 19, 3, 5, 2, 3, count],
        backgroundColor: "rgba(99, 102, 241, 0.6)",
      },
    ],
  };

  return (
    <div style={{ fontFamily: "system-ui", padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Test Canvas</h2>
      <p>Sandboxed iframe, Chart.js, React state. Sunday bar = {count}.</p>
      <button
        type="button"
        onClick={() => setCount((c) => c + 1)}
        style={{
          padding: "6px 12px",
          borderRadius: 6,
          border: "1px solid #ddd",
          cursor: "pointer",
          marginBottom: 12,
        }}
      >
        Bump Sunday
      </button>
      <div style={{ height: 280 }}>
        <Bar
          data={data}
          options={{ responsive: true, maintainAspectRatio: false }}
        />
      </div>
    </div>
  );
}
