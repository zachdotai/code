import type { CanvasTokens } from "@features/rendering-canvas/canvas-theme";

const ESM = "https://esm.sh";

interface BuildCanvasSrcDocOptions {
  tokens?: CanvasTokens;
}

export function buildCanvasSrcDoc(
  content: string,
  opts: BuildCanvasSrcDocOptions = {},
): string {
  const escaped = content.replace(/<\/script>/gi, "<\\/script>");
  const cssVars = opts.tokens?.cssVars ?? {};
  const rootBlock = Object.entries(cssVars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  const tokensLiteral = JSON.stringify(cssVars);
  const colorScheme = opts.tokens?.isDark ? "dark" : "light";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://esm.sh https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://esm.sh https://cdn.jsdelivr.net; connect-src https://esm.sh https://cdn.jsdelivr.net; img-src data: blob:; font-src data: https://esm.sh https://cdn.jsdelivr.net;" />
<style>
:root { color-scheme: ${colorScheme}; }
:root {
${rootBlock}
}
html, body { margin: 0; padding: 0; font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif); color: var(--gray-12, inherit); background: var(--gray-1, transparent); }
#root { padding: 12px; }
.canvas-error { color: var(--red-11, #b91c1c); font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; white-space: pre-wrap; padding: 12px; }
.canvas-status { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 200px; padding: 12px; color: var(--gray-9, #62635f); font-size: 13px; }
.canvas-status__spinner { width: 16px; height: 16px; border: 2px solid var(--gray-4, #d9d9d6); border-top-color: var(--gray-9, #62635f); border-radius: 50%; animation: canvas-spin 0.7s linear infinite; }
@keyframes canvas-spin { to { transform: rotate(360deg); } }
</style>
<script type="importmap">
{
  "imports": {
    "react": "${ESM}/react@19",
    "react-dom": "${ESM}/react-dom@19",
    "react-dom/client": "${ESM}/react-dom@19/client",
    "react/jsx-runtime": "${ESM}/react@19/jsx-runtime",
    "chart.js": "${ESM}/chart.js@4",
    "chart.js/auto": "${ESM}/chart.js@4/auto",
    "react-chartjs-2": "${ESM}/react-chartjs-2@5?deps=react@19,react-dom@19,chart.js@4"
  }
}
</script>
</head>
<body>
<div id="root"></div>
<script>
  // Top-level error visibility — surface anything that breaks before the module loads.
  window.addEventListener("error", (e) => {
    const msg = "Script error: " + (e.message || "unknown") + (e.filename ? " (" + e.filename + ":" + e.lineno + ")" : "");
    document.getElementById("root").innerHTML = '<div class="canvas-error"></div>';
    document.getElementById("root").firstChild.textContent = msg;
    try { parent.postMessage({ kind: "canvas:error", message: msg }, "*"); } catch (_) {}
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason && (e.reason.stack || e.reason.message) || String(e.reason);
    const msg = "Unhandled rejection: " + reason;
    document.getElementById("root").innerHTML = '<div class="canvas-error"></div>';
    document.getElementById("root").firstChild.textContent = msg;
    try { parent.postMessage({ kind: "canvas:error", message: msg }, "*"); } catch (_) {}
  });
</script>
<script type="module">
function showStatus(msg) {
  const el = document.getElementById("root");
  if (el) {
    el.innerHTML = '<div class="canvas-status"><div class="canvas-status__spinner"></div><span class="canvas-status__text"></span></div>';
    el.querySelector(".canvas-status__text").textContent = msg;
  }
  try { parent.postMessage({ kind: "canvas:status", message: msg }, "*"); } catch (_) {}
}

showStatus("Loading dependencies…");

let React, useEffect, useState, useCallback, useMemo, useRef, createRoot, ChartJS, ReactChartJS;
try {
  const reactMod = await import("react");
  React = reactMod.default ?? reactMod;
  useEffect = reactMod.useEffect; useState = reactMod.useState;
  useCallback = reactMod.useCallback; useMemo = reactMod.useMemo; useRef = reactMod.useRef;
  showStatus("Loaded react, loading react-dom…");
  ({ createRoot } = await import("react-dom/client"));
  showStatus("Loaded react-dom, loading chart.js…");
  ChartJS = await import("chart.js/auto");
  showStatus("Loaded chart.js, loading react-chartjs-2…");
  ReactChartJS = await import("react-chartjs-2");
  showStatus("Dependencies loaded, compiling…");
} catch (err) {
  renderError("Dependency load failed: " + (err && (err.stack || err.message) || err));
  throw err;
}

const __pending = new Map();
let __seq = 0;

function callApi(path, ...args) {
  const id = ++__seq;
  return new Promise((resolve, reject) => {
    __pending.set(id, { resolve, reject });
    parent.postMessage({ kind: "canvas:api", id, path, args }, "*");
  });
}

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.kind === "canvas:api-result") {
    const p = __pending.get(msg.id);
    if (!p) return;
    __pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  }
});

const api = new Proxy(function () {}, {
  get(_t, prop) {
    return makeApiPath([prop]);
  },
  apply() {
    throw new Error("api() must be called via a dotted path, e.g. api.insights.list()");
  },
});

function makeApiPath(parts) {
  const fn = (...args) => callApi(parts.join("."), ...args);
  return new Proxy(fn, {
    get(_t, prop) {
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return makeApiPath([...parts, prop]);
    },
  });
}

function useApi(path, args, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const refetch = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return callApi(path, ...(args ?? []))
      .then((data) => setState({ loading: false, data, error: null }))
      .catch((error) => setState({ loading: false, data: null, error }));
  }, [path, JSON.stringify(args ?? [])]);
  useEffect(() => { refetch(); }, deps ?? [refetch]);
  return { ...state, refetch };
}

// --- PostHog canvas primitives ---------------------------------------------
// Plain JS (no JSX) so they don't need Babel. Use CSS custom properties from
// the host so light/dark stays in sync with the rest of the app.
const __h = React.createElement;

function PageHeader({ title, subtitle, action }) {
  return __h(
    "header",
    { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 } },
    __h(
      "div",
      { style: { minWidth: 0 } },
      __h("h2", { style: { margin: 0, fontSize: 18, fontWeight: 600, color: "var(--gray-12)" } }, title),
      subtitle
        ? __h("p", { style: { margin: "2px 0 0", fontSize: 12, color: "var(--gray-10)" } }, subtitle)
        : null,
    ),
    action ? __h("div", { style: { flexShrink: 0 } }, action) : null,
  );
}

function Section({ title, children }) {
  return __h(
    "section",
    {
      style: {
        border: "1px solid var(--gray-5)",
        borderRadius: "var(--radius-3, 6px)",
        padding: 12,
        background: "var(--gray-2)",
        marginBottom: 12,
      },
    },
    title
      ? __h("h3", { style: { margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--gray-12)" } }, title)
      : null,
    children,
  );
}

function KpiRow({ children, columns }) {
  const count = columns ?? React.Children.count(children);
  return __h(
    "div",
    {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(" + count + ", minmax(0, 1fr))",
        gap: 8,
        marginBottom: 12,
      },
    },
    children,
  );
}

function Kpi({ label, value, hint, tone }) {
  const toneColor =
    tone === "positive" ? "var(--green-11)"
    : tone === "negative" ? "var(--red-11)"
    : tone === "brand" ? "var(--orange-9)"
    : "var(--gray-12)";
  return __h(
    "div",
    {
      style: {
        border: "1px solid var(--gray-5)",
        borderRadius: "var(--radius-3, 6px)",
        padding: 12,
        background: "var(--gray-2)",
      },
    },
    __h(
      "div",
      { style: { fontSize: 11, color: "var(--gray-10)", textTransform: "uppercase", letterSpacing: 0.4 } },
      label,
    ),
    __h(
      "div",
      { style: { fontSize: 22, fontWeight: 600, marginTop: 4, color: toneColor } },
      value,
    ),
    hint
      ? __h("div", { style: { fontSize: 11, color: "var(--gray-9)", marginTop: 2 } }, hint)
      : null,
  );
}

function EmptyState({ children }) {
  return __h("div", { style: { color: "var(--gray-9)", fontSize: 13, padding: 12 } }, children);
}

function ErrorState({ children }) {
  return __h(
    "div",
    {
      style: {
        color: "var(--red-11)",
        padding: 12,
        background: "var(--red-3)",
        border: "1px solid var(--red-5)",
        borderRadius: "var(--radius-2, 4px)",
        fontSize: 12,
        whiteSpace: "pre-wrap",
      },
    },
    children,
  );
}

function chartTheme(overrides) {
  const cs = getComputedStyle(document.documentElement);
  const grid = cs.getPropertyValue("--gray-5").trim() || "rgba(0,0,0,0.06)";
  const tick = cs.getPropertyValue("--gray-10").trim() || "#5a6054";
  const base = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: tick, font: { size: 11 } } } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 10 }, color: tick } },
      y: { grid: { color: grid }, ticks: { font: { size: 10 }, color: tick } },
    },
  };
  return overrides ? Object.assign({}, base, overrides) : base;
}

const tokens = ${tokensLiteral};

const scope = {
  React,
  useState, useEffect, useCallback, useMemo, useRef,
  api, useApi,
  Chart: ChartJS.Chart,
  Chartjs: ChartJS,
  Line: ReactChartJS.Line,
  Bar: ReactChartJS.Bar,
  Pie: ReactChartJS.Pie,
  Doughnut: ReactChartJS.Doughnut,
  Radar: ReactChartJS.Radar,
  PolarArea: ReactChartJS.PolarArea,
  Bubble: ReactChartJS.Bubble,
  Scatter: ReactChartJS.Scatter,
  // PostHog primitives
  PageHeader, Section, KpiRow, Kpi, EmptyState, ErrorState, chartTheme, tokens,
};

const USER_SOURCE = ${JSON.stringify(escaped)};

async function main() {
  let Babel;
  try {
    Babel = await import("https://esm.sh/@babel/standalone@7");
  } catch (err) {
    renderError("Failed to load compiler: " + err.message);
    return;
  }
  let transformed;
  try {
    // Strip ESM import/export syntax before Babel — new Function() can't run it,
    // and all dependencies are injected into scope as globals.
    const stripped = USER_SOURCE
      .replace(/imports+[sS]*?froms+['"][^'"]+['"]s*;?/g, "")
      .replace(/imports+['"][^'"]+['"]s*;?/g, "")
      .replace(/exports+defaults+(?=[A-Za-z_{(])/g, "")
      .replace(/exports+(?=(?:function|class|const|let|var)\b)/g, "")
      .replace(/exports*{[sS]*?}s*(?:froms*['"][^'"]+['"])?s*;?/g, "");
    const { code } = Babel.transform(stripped, {
      presets: [["react", { runtime: "classic" }], ["typescript", { allExtensions: true, isTSX: true }]],
      filename: "canvas.tsx",
    });
    transformed = code.trim();
  } catch (err) {
    renderError("Compile error: " + err.message);
    return;
  }

  let Component;
  try {
    const argNames = Object.keys(scope);
    const argValues = Object.values(scope);
    const body = transformed + "\\n;return (typeof App !== 'undefined' ? App : (typeof default_1 !== 'undefined' ? default_1 : null));";
    const factory = new Function(...argNames, body);
    Component = factory(...argValues);
    if (!Component) throw new Error("Canvas must export a component named 'App' or default.");
  } catch (err) {
    renderError("Runtime error: " + err.message);
    return;
  }

  try {
    const root = createRoot(document.getElementById("root"));
    root.render(React.createElement(ErrorBoundary, null, React.createElement(Component)));
    parent.postMessage({ kind: "canvas:ready" }, "*");
  } catch (err) {
    renderError("Render error: " + err.message);
  }
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return React.createElement("div", { className: "canvas-error" }, "Render error: " + this.state.error.message);
    }
    return this.props.children;
  }
}

function renderError(msg) {
  const el = document.getElementById("root");
  if (el) el.innerHTML = '<div class="canvas-error"></div>';
  el.firstChild.textContent = msg;
  parent.postMessage({ kind: "canvas:error", message: msg }, "*");
}

main();
</script>
</body>
</html>`;
}
