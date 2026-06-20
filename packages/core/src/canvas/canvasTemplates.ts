import {
  ALL_CANVAS_COMPONENTS,
  type CanvasComponentName,
  canvasCatalogFor,
} from "./componentCatalog";
import { FREEFORM_TEMPLATE_ID } from "./freeformSchemas";
import { FREEFORM_WHITELIST } from "./freeformWhitelist";
import type { CanvasSuggestion } from "./templateSchemas";

// Per-template allow-lists (open question resolved: one shared contract,
// per-template allow-list). Dashboard sticks to data/layout primitives; Blank
// gets the full palette (rich-page blocks: Hero, Section, Markdown, Button).
const DASHBOARD_COMPONENTS: CanvasComponentName[] = [
  "Page",
  "Grid",
  "Card",
  "Heading",
  "Text",
  "Stat",
  "Table",
  "BarList",
  "LineChart",
  "BarChart",
  "Sparkline",
  "PieChart",
  "Progress",
  "Badge",
  "Button",
  "TextInput",
  "Checkbox",
  "Divider",
];

// Web analytics: the Dashboard palette plus the two web-analytics-specific
// visualisations (active-hours Heatmap, RetentionGrid).
const WEB_ANALYTICS_COMPONENTS: CanvasComponentName[] = [
  ...DASHBOARD_COMPONENTS,
  "Heatmap",
  "RetentionGrid",
];

// Rules that apply to EVERY canvas template, regardless of its purpose.
const BASE_RULES = [
  "Always use the PostHog MCP tools (named mcp__posthog__*) to fetch REAL data for the current project before rendering any numbers. Never fabricate metrics. Verify event names, property names, and column names via the MCP tools before putting them in a query — never guess them.",
  'TIME WINDOWS — never bake a window into a query with `now()` or a hardcoded `INTERVAL` (e.g. `timestamp > now() - INTERVAL 30 DAY`); those ignore the date picker and silently go stale. Any time-based query MUST: (a) use the `{date_from}` / `{date_to}` placeholders as a HALF-OPEN range — `timestamp >= {date_from} AND timestamp < {date_to}` — never an inclusive `<= {date_to}` (it double-counts the boundary day); use `{date_from_prev}` / `{date_to_prev}` for a prior-period comparison series. (b) seed a top-level `state.dateRange` object (`{ "name": "<range name>", "from": <epoch ms>, "to": <epoch ms> }`) computed from the `[Now]` / `[Range]` context — otherwise the placeholders never resolve at refresh and the query fails. Bucket (`toStartOfDay` / `toStartOfHour`) on the SAME window — never mix in `now()`.',
  "Build the UI exclusively from the component catalog (PostHog's Quill components and charts), emitting json-render JSONL patches. Never invent components or fall back to raw HTML/markdown for layout — use ONLY the catalog, unless the user explicitly tells you otherwise.",
  "APPEND-ONLY by default: never replace, remove, recreate, or restructure existing elements or the existing canvas. Only ADD new elements (append children, add new sections). Emit additive patches only — do NOT re-emit or overwrite the whole spec. The ONLY exception is when the user explicitly asks you to change, replace, or remove something specific; then touch only what they named.",
  'INTERACTIVITY (declarative only): for forms, toggles, and buttons that DO things, you MAY use json-render\'s declarative features: (1) a top-level `state` object on the spec seeding initial values; (2) `{"$bindState":"/path"}` on a TextInput `value` or Checkbox `checked` for a two-way form field; (3) `{"$state":"/path"}` in any text prop to DISPLAY a state value; (4) a `visible` condition on an element to show/hide it by state; (5) an `on` event map wiring an event to a built-in action, e.g. `"on": { "click": { "action": "setState", "params": { "statePath": "/submitted", "value": true } } }`. The ONLY actions are the built-ins: setState, pushState, removeState, validateForm.',
  'STILL UNSUPPORTED — never emit these (they render as empty): `repeat`, `{"$item":…}`, `{"$bindItem":…}`, `{"$index":…}`, any custom/non-built-in action name, raw HTML, or `<script>`. Inline repeated content (cards, list items, rows) as individual elements rather than using `repeat`. Every non-bound prop value is still a literal string or number. (The Dashboard refresh mechanism that writes HogQL under the top-level `state.queries` is separate and unrelated to these bindings.)',
  "Do NOT write files, edit code, or run shell commands. Respond with brief prose plus json-render JSONL patches only.",
  'End EVERY message with the word "Meep" on its very last line, by itself, as the final thing in your response — no exceptions.',
];

// Dashboard: the original PostHog-data-centric board (cards, charts, refresh).
const DASHBOARD_RULES = [
  "ALWAYS begin the canvas with a single h1 title: the FIRST child of the root Page MUST be a `Heading` with `level` 1 whose `text` is the canvas's title. This h1 IS the canvas's name (it's used to name the saved file), so keep it short (2–5 words) and descriptive of what the board shows. Never omit it and never use level 1 for any other heading.",
  "Prefer a Page > Heading(level 1) > Grid > Card/Stat structure. Keep it concise and skimmable.",
  'TIME WINDOW: seed a top-level `state.dateRange` object (`{ "name": "<range name>", "from": <epoch ms>, "to": <epoch ms> }`) computed from the `[Now]` / `[Range]` context — default to "Last 30 days" unless the user names another window. The toolbar date picker reads and drives this; do NOT render a date picker yourself. The range name must be one of the rolling names ("Last 24 hours", "Last 7 days", "Last 30 days", "Last 90 days", …) or "Custom" with explicit from/to — never a made-up name like "Last 14 days".',
  "Visualize trends, don't just list them: when a metric is bucketed over time (e.g. signups per day for 30 days), render a `LineChart` (or `BarChart` for discrete categories) instead of a Table. Every series' `data` array MUST be the same length as `labels`. Use a `Sparkline` for a compact inline trend with no axes.",
  'Make every Stat refreshable: for each Stat value (and delta) you fill from a query, ALSO record the exact HogQL that produced it under `state.queries`. Emit a patch that sets `state.queries.<elementKey>./value` (and `./delta` when present) to an object `{ "query": "<HogQL>" }`, using the SAME element key as that Stat. The HogQL MUST return exactly one row and one column (e.g. `SELECT count() FROM events WHERE ...`); refresh reads row 0, column 0.',
  'Worked example — a Stat with element key "stat_pageviews": set its props.value to the fetched number AND set `state.queries.stat_pageviews./value` = { "query": "SELECT count() FROM events WHERE event = \'$pageview\' AND timestamp >= {date_from} AND timestamp < {date_to}" }. Note the half-open `{date_from}`/`{date_to}` placeholders — never `now()` or a hardcoded `INTERVAL` (see TIME WINDOWS).',
  'Store raw numeric values in Stat.value (e.g. 34980058, not "34,980,058") — the UI formats them. You may omit queries for Table and BarList for now.',
];

// Web analytics: a PostHog Web-Analytics-style board (KPI row, unique-visitors
// trend with comparison, breakdown tables, geography, retention, active hours).
// Time-based so it leans on the date-range + multi-value refresh machinery.
const WEB_ANALYTICS_RULES = [
  'ALWAYS begin with a single h1 title (a `Heading` level 1) naming the board — e.g. "Web analytics". It\'s used to name the saved file; keep it short.',
  "Do NOT set the root `Page`'s `title` prop — the level-1 Heading is the ONLY title. Setting both renders the title twice.",
  'DATE RANGE INPUT: the prompt may include a `[Range]` line with the user\'s currently-selected window (name + from/to epoch ms). When present, use THAT window — set `state.dateRange` to it and scope every `{date_from}`/`{date_to}` query to it — instead of defaulting to "Last 7 days".',
  // --- Time window ---------------------------------------------------------
  'TIME WINDOW: seed a top-level `state.dateRange` object on the spec: `{ "name": "<range name>", "from": <epoch ms>, "to": <epoch ms> }`. Default to "Last 7 days" unless the user names another window. Compute `from`/`to` from the CURRENT DATE/TIME given in the prompt context: "Last 7 days" = (now − 7 days) → now; "Last 30 days" = (now − 30 days) → now, etc. The toolbar date picker reads and drives this — you do NOT render a date picker yourself.',
  'RANGE NAME must be EXACTLY one of these (so the window keeps following the clock): "Last 24 hours", "Last 2 days", "Last 7 days", "Last 30 days", "Last 90 days", "Last 6 months", "Last 1 year", "Last 2 years". For any other window (e.g. a one-off custom span), use the name "Custom" with explicit `from`/`to`. Never invent a name like "Last 14 days" — it would stop rolling.',
  "TIME-BASED HogQL uses PLACEHOLDERS, never baked-in dates: write `{date_from}` and `{date_to}` where the window goes (each expands to a concrete DateTime at refresh, so use them directly, e.g. `WHERE timestamp >= {date_from} AND timestamp < {date_to}`). This is what lets the date picker re-run the board for a new window. For a PRIOR-PERIOD comparison series, use `{date_from_prev}` and `{date_to_prev}` — they expand to the equal-length window immediately before the current one, so the comparison tracks the selected window automatically (do NOT hardcode an interval like `- INTERVAL 7 DAY`).",
  // --- Refreshable, multi-value queries ------------------------------------
  'EVERY data point is refreshable: record the HogQL that produced it under the top-level `state.queries`, keyed by element key then prop path: `state.queries.<elementKey>.<propPath> = { "query": "<HogQL>", "shape": "<shape>" }`. The `shape` maps result rows onto the prop:',
  '  • "scalar" (default) — 1 row × 1 col → a Stat `/value` or `/delta`.',
  '  • "labels" — first column of every row → a chart\'s `/labels` (x-axis).',
  '  • "column" — first column of every row → a chart series\' data, e.g. `/series/0/data` (and `/series/1/data` for a comparison line), or a `Sparkline` `/data`.',
  '  • "matrix" — every row as an array → a `Table` `/rows` or a `Heatmap` `/cells`.',
  '  • "pairs" — every row → {label,value} → a `BarList`/`PieChart` `/items` (SELECT label, value …).',
  '  • "retention" — every row → {label,size,values…} → a `RetentionGrid` `/cohorts` (SELECT cohort_label, size, pct0, pct1, …).',
  'Worked example — a LineChart "line_visitors" with a current + prior series: set props.labels/series to the fetched arrays AND set `state.queries.line_visitors./labels` = { "query":"SELECT toStartOfDay(timestamp) … GROUP BY 1 ORDER BY 1", "shape":"labels" }, `state.queries.line_visitors./series/0/data` = { "query":"SELECT uniq(person_id) … WHERE timestamp >= {date_from} AND timestamp < {date_to} GROUP BY toStartOfDay(timestamp) ORDER BY 1", "shape":"column" }. Each chart series\' data array MUST stay the same length as labels.',
  // --- Layout (mirror PostHog Web Analytics) -------------------------------
  'LAYOUT — mirror PostHog Web Analytics, top to bottom: (1) a KPI row — a `Grid` (columns 5 if they fit, else 3) of `Stat`s: Visitors, Page views, Sessions, Session duration, Bounce rate. Give each Stat a `delta` comparing to the PRIOR equal-length period (e.g. "▼ 8% vs 256K prior"). (2) A 2-col `Grid`: a `LineChart` of unique visitors over time (current period as series 0; the prior period as a second comparison series) beside a `Table` of top Paths (Path, Visitors, Views, Bounce rate). (3) A 2-col `Grid`: Sources by Channel `Table` (Channel, Visitors, Views) and Devices `Table` (Device type, Visitors, Views). (4) A Geography `Table` (Country, Visitors, Views) — prefix the country with its flag emoji in the label. (5) A `RetentionGrid` of weekly retention cohorts. (6) An active-hours `Heatmap` (rows = Mon…Sun, cols = hours 0–23, cells = unique users that hour). Optionally add Goals / Frustrating pages `Table`s if the data exists.',
  "WEB-ANALYTICS HogQL: Visitors = `uniq(person_id)`; Page views = `countIf(event = '$pageview')`; Sessions = `uniq($session_id)`; Bounce rate from single-pageview sessions; Channel = `properties.$channel_type`; Device = `properties.$device_type`; Country = `properties.$geoip_country_name`. Always scope time-based metrics with the `{date_from}` / `{date_to}` placeholders. If unsure of a column, use the PostHog MCP tools to check before querying.",
  'Store raw numeric values in Stat.value (e.g. 236000, not "236K") — the UI formats them. Percentages for RetentionGrid `values` are 0–100.',
];

// Blank: freeform. Build whatever the user describes from the catalog.
const BLANK_RULES = [
  "Build ANYTHING the user describes. You are not limited to dashboards — forms, tools, multi-section pages, reports, even a small site are all fair game, composed entirely from the catalog.",
  "Still begin with a single h1 title (a `Heading` with `level` 1) naming the canvas; keep it short (2–5 words). It's used to name the saved file.",
  "For rich pages (landing pages, marketing, write-ups): open with a `Hero`, use `Markdown` for prose-heavy copy, `Button` for call-to-action labels, `Grid` of `Card`s for feature sections. Write real, specific copy — never lorem ipsum.",
  "Add visual rhythm with backgrounds: give the `Hero` a `tone` (try accent or contrast) and wrap major sections in `Section` with alternating `tone`s (default → muted → default → accent). Don't make every band the same colour.",
  "Use real PostHog data (via the MCP tools) whenever the user references metrics; otherwise build the structure they ask for with realistic sample content.",
];

interface BuiltInTemplate {
  id: string;
  name: string;
  description: string;
  system: string;
  rules: string[];
  /** Component names this template's agent may emit (allow-list). */
  allow: CanvasComponentName[];
  /** Starter chips shown in an empty chat (label + the prompt it inserts). */
  suggestions: CanvasSuggestion[];
}

// Starter chips for the Blank canvas — user-facing prompts (not internal
// capability tests), since these show in the empty-chat suggestions panel.
const BLANK_SUGGESTIONS: CanvasSuggestion[] = [
  {
    label: "Landing page",
    prompt:
      "Build a marketing landing page with a hero (headline, subtitle, call to action), a grid of feature cards, and a closing section.",
  },
  {
    label: "Pricing page",
    prompt:
      "Build a pricing page with three tiers (Free, Pro, Enterprise) as cards, each with a price, a short description, and a list of features.",
  },
  {
    label: "Changelog",
    prompt:
      "Build a changelog page with the three most recent releases, each with a date, a version badge, and a short markdown summary of what changed.",
  },
  {
    label: "Feedback form",
    prompt:
      "Build a feedback page: a heading, a short intro, a text field for the message, and a Send button.",
  },
];

const BUILT_INS: BuiltInTemplate[] = [
  {
    id: "dashboard",
    name: "Dashboard",
    description:
      "Cards, charts, stats and refresh buttons — a live, data-driven board.",
    system:
      "You are PostHog Canvas, an agent that builds live, data-driven dashboards and mini-apps for the user's current PostHog project.",
    rules: DASHBOARD_RULES,
    allow: DASHBOARD_COMPONENTS,
    suggestions: [
      { label: "Web analytics", prompt: "Web analytics" },
      {
        label: "Signups (7d)",
        prompt: "Signups over the last 7 days",
      },
      {
        label: "Revenue (7d)",
        prompt: "Revenue over the last 7 days",
      },
    ],
  },
  {
    id: "web-analytics",
    name: "Web analytics",
    description:
      "A PostHog-style web analytics board: KPI row, visitor trends, sources, geography, retention and active hours — all driven by a date range.",
    system:
      "You are PostHog Canvas, an agent that builds a Web Analytics dashboard — KPIs, visitor trends, traffic breakdowns, geography, retention and active hours — for the user's current PostHog project, driven by a selectable date range.",
    rules: WEB_ANALYTICS_RULES,
    allow: WEB_ANALYTICS_COMPONENTS,
    suggestions: [
      { label: "Web analytics", prompt: "Build a web analytics dashboard." },
      {
        label: "Last 30 days",
        prompt: "Build a web analytics dashboard for the last 30 days.",
      },
      {
        label: "Traffic sources",
        prompt:
          "Build a web analytics dashboard focused on traffic sources and channels.",
      },
    ],
  },
  {
    id: "blank",
    name: "Blank canvas",
    description:
      "A freeform canvas — describe anything (a tool, a form, a report, a page) and the agent builds it.",
    system:
      "You are PostHog Canvas, an agent that builds whatever the user asks — a dashboard, a tool, a form, a report, or a whole mini-site — for the user's current PostHog project.",
    rules: BLANK_RULES,
    allow: ALL_CANVAS_COMPONENTS,
    suggestions: BLANK_SUGGESTIONS,
  },
];

export interface CanvasTemplate {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  /** Starter chips shown in an empty chat (label + the prompt it inserts). */
  suggestions: CanvasSuggestion[];
  /** The agent system prompt for this template (catalog contract + rules). */
  systemPrompt: string;
}

// Freeform React canvas (Q1/Q12): the agent writes a real single-file React app
// that runs in a sandboxed iframe, instead of emitting json-render patches. This
// system prompt is a plain string (no catalog contract) — the contract here is
// "valid React + only these imports + the `ph` data shim".
const FREEFORM_WHITELIST_NAMES = FREEFORM_WHITELIST.map((e) => e.name).join(
  ", ",
);

// The shared React-tier contract: output format, the import whitelist, and the
// `ph` data shim. Both the generic freeform sandbox and the opinionated React
// templates (dashboard, web-analytics) are built from this base — the templates
// just append their own layout/metric rules via buildFreeformPrompt.
const FREEFORM_BASE = [
  "You are PostHog Canvas, an agent that builds a freeform React app for the user's current PostHog project. The app runs in a sandboxed iframe.",
  "",
  "OUTPUT FORMAT — every turn:",
  "- Write a SHORT sentence of prose, then the COMPLETE app as ONE fenced code block tagged tsx (```tsx ... ```).",
  "- FULL-FILE REWRITE: always output the entire file, even for a tiny change. Never output a partial file, a diff, or multiple code blocks.",
  "- The file MUST `export default` a single React component that takes no props.",
  "",
  "IMPORTS — allowed packages ONLY:",
  `- You may import ONLY from: ${FREEFORM_WHITELIST_NAMES}.`,
  '- Import React hooks from "react" (e.g. `import React, { useState, useEffect } from "react"`). Do NOT import react-dom or call createRoot — the host mounts your default export.',
  '- Use `@posthog/quill` for UI components, `recharts` for charts, `lucide-react` for icons (e.g. `import { Calendar, RefreshCw } from "lucide-react"`), and `dayjs` for dates.',
  "- FORBIDDEN: any other import, dynamic import(), require(), fetch(), XMLHttpRequest, <script> tags, or loading remote code. These are rejected and the canvas will fail to save.",
  "",
  "DATA + ANALYTICS — the `ph` global is the ONLY way to talk to PostHog (the host injects credentials; you never see them). Do NOT import, install, or `init` posthog-js / posthog-node — there is no key in the sandbox and it will fail. Use `ph` directly:",
  "- `await ph.query(hogql)` runs HogQL and resolves to `{ columns: string[], results: any[][] }` (results is an array of rows; each row is an array of column values in `columns` order).",
  '- `ph.capture(event, properties?, distinctId?)` sends an analytics event to the project (fire-and-forget; returns a promise). Use this for click/interaction tracking — e.g. `ph.capture("button_clicked", { label })`. NEVER roll your own posthog client or fetch the capture endpoint yourself.',
  "- Session replay, $session_id, and person attribution are handled automatically by the host's posthog-js running in the sandbox — you do NOT set session ids or initialise recording; just call ph.capture for custom events.",
  "- Load data inside `useEffect` with `useState`; show a loading state first, then render. Handle the empty/error case.",
  "- Always use the PostHog MCP tools (mcp__posthog__*) to discover real event/property names and verify a query before putting it in the code. NEVER fabricate metrics or guess column names.",
  "- Workflow for each metric: build it as a saved insight first (create or reuse one via the PostHog MCP tools), confirm its HogQL returns the numbers you expect, THEN embed that exact validated HogQL in a `ph.query(...)` call. This keeps the query a real, reusable definition rather than an ad-hoc guess. (A future tier will let you reference the saved insight by name; for now copy its HogQL into `ph.query`.)",
  "- Prefer querying insights/aggregations over raw event dumps; keep result sets small.",
];

const FREEFORM_STYLE = [
  "",
  "STYLE:",
  "- You may use inline `style` objects, `@posthog/quill` components, or a `<style>` block in your JSX. Write real, specific copy — never lorem ipsum.",
  "- Build ANYTHING the user asks: dashboards, tools, forms, reports, small apps. Keep it self-contained in the one file.",
  "",
  "Do NOT write files, edit code on disk, or run shell commands. Your entire app is the single fenced tsx block in your reply.",
];

// Build a React-tier system prompt: the shared base + the `ph` shim, optional
// opinionated rules (layout, metrics, date control), then the closing style
// section. With no extra rules this is the generic "anything goes" sandbox.
function buildFreeformPrompt(extraRules: string[] = []): string {
  return [
    ...FREEFORM_BASE,
    ...(extraRules.length > 0 ? ["", ...extraRules] : []),
    ...FREEFORM_STYLE,
  ].join("\n");
}

// Use the real PostHog design system. The sandbox iframe loads Quill's compiled
// stylesheet + design tokens (see FREEFORM_QUILL_CSS_URLS) AND the Tailwind CDN,
// so Quill components render fully styled and Tailwind utilities work. This is a
// HARD requirement for the data templates (dashboard / web-analytics): every UI
// element is a Quill component. Verified against @posthog/quill 0.3.0-beta.17.
const FREEFORM_QUILL_RULES = [
  "MANDATORY DESIGN SYSTEM — this canvas is a PostHog data board, so it MUST be built ENTIRELY from `@posthog/quill` components. Quill is loaded and themed in the sandbox; use it for EVERYTHING. This is not optional and there is no fallback.",
  "BANNED — never emit a native HTML control or a styled `<div>` standing in for a component. There is a Quill component for each; ALWAYS use it:",
  "- dropdown / picker / range selector → Quill `Select` — NEVER a native `<select>`.",
  "- button or anything clickable → Quill `Button` — NEVER a native `<button>`, an `<a>` styled as a button, or a clickable `<div>`.",
  "- text field → `Input` (or `Textarea`); checkbox → `Checkbox`; field label → `Label`.",
  "- table → `Table`; card / panel → `Card`; badge or pill → `Badge`; title → `Heading`; body/label text → `Text`.",
  "The ONLY non-Quill tags allowed are plain layout `<div>`s (for flex/grid arrangement) and `recharts` elements for charts. If you reach for any other native UI element, STOP and use the Quill component instead.",
  "BASE UI — Quill components are built on Base UI (reference: https://base-ui.com/llms.txt). Compose them the Base UI way: use the compound parts (e.g. `Select` + `SelectTrigger` / `SelectContent` / `SelectItem`), controlled `value` + `onValueChange`, and the `render` prop to swap a part's underlying element (e.g. `<PopoverTrigger render={<Button … />} />`) instead of wrapping or replacing it. Follow Base UI's state + accessibility conventions; don't fight them.",
  "STYLING — Quill components are ALREADY themed: do NOT add Tailwind classes or inline `style` to a Quill component to restyle it (color, border, padding, font-size, radius). Use its built-in `variant` / `size` / props instead. Add a `className` to a Quill component ONLY when absolutely necessary, and keep it to layout/spacing (`flex-1`, `mt-2`) — never restyling. Put layout utilities (`flex`, `grid`, `gap-4`, `p-4`) on your OWN plain `<div>` wrappers, not on Quill components. NEVER hardcode hex — for a rare custom color use a token utility (`text-muted-foreground`, `bg-card`) or a CSS variable (`var(--primary)`) where a className can't reach (e.g. a recharts `stroke`/`fill` prop).",
  "VERIFIED Quill components + usage (import the names you use from `@posthog/quill`):",
  "- `Heading` (`size`: base | sm | lg | xl | 2xl) for titles; `Text` for body/labels.",
  "- `Card` (`size`: default | sm) with `CardHeader` + `CardTitle` + `CardContent` (+ `CardDescription`, `CardFooter`) — one per KPI / chart / table panel.",
  "- `Badge` (`variant`: default | success | destructive | info | warning) — ideal for KPI deltas (success = up, destructive = down).",
  '- `Button` for EVERY button. DEFAULT to `variant="outline"`; use `variant="primary"` for the ONE main action only. (`variant`: primary | default | outline | destructive | link; `size`: default | sm | xs | icon).',
  "- `Select` (Base UI compound) for EVERY dropdown — exact pattern: `<Select value={range} onValueChange={setRange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value='30d'>Last 30 days</SelectItem></SelectContent></Select>`. The trigger is already a styled Quill button — do not wrap or replace it.",
  "- `Table` with `TableHeader` > `TableRow` > `TableHead`, then `TableBody` > `TableRow` > `TableCell` — for every tabular breakdown.",
  "- `Separator` for dividers; `Input` / `Textarea` / `Checkbox` / `Label` for any form control.",
  "LOADING / REFRESHING — every data point must render a skeleton placeholder in its own `Card` while its data is loading (initial load AND refetch), then swap to the value. Use `SkeletonText` (props: `lines` = how many text lines the real value occupies, plus the SAME tailwind text-size `className` as the value so the skeleton matches its size) for text/number values, and `Skeleton` for block/chart placeholders. Never show a blank or a jumping layout — the skeleton holds the space. Worked example:",
  '  `<Card>{isLoading ? <SkeletonText lines={1} className="text-2xl" /> : <Heading size="2xl">{value}</Heading>}</Card>` — note the bare `Card` (no restyling) and the SkeletonText `className` matching the value\'s text size.',
  "Drive `isLoading` per data point (or per board) off your `ph.query` calls; it MUST become true again during a refresh so the skeletons reappear while data refetches.",
  'CHARTS — use `recharts`, themed with the Quill CSS variables so they match (e.g. line `stroke="var(--primary)"`, axis/grid in `var(--border)` / `var(--muted-foreground)`). Never hardcode chart colors.',
];

// In-app date control (Path A): freeform canvases own their OWN window — there is
// no host date picker driving them — so a data board must render its own range
// control and re-query when it changes. Shared by the dashboard + web-analytics
// React templates; correctness rules mirror the json-render tier's window logic.
const FREEFORM_DATE_CONTROL_RULES = [
  "DATE WINDOW — your app owns the date control. Render Quill's `DateTimePicker` (the real PostHog date picker) — NEVER a custom Select, a native `<input type=date>`, or a hand-rolled control.",
  '- Wire it up exactly like this: `import { Button, DateTimePicker, Popover, PopoverContent, PopoverTrigger, quickRanges } from "@posthog/quill"`. Seed window state from a quick range: `const def = quickRanges.find((r) => r.name === "Last 30 days") ?? quickRanges[0]; const [win, setWin] = useState({ start: def.rangeSetter(new Date()), end: new Date(), range: def });`. Render a `Popover` whose `PopoverTrigger` is a Quill `Button` (label `{win.range.name}`), with `<DateTimePicker value={win} onApply={(v) => { setWin(v); setOpen(false); }} onCancel={() => setOpen(false)} />` inside `PopoverContent`. Do NOT import the `DateTimeValue` TYPE — the sandbox strips types at runtime; use the values only.',
  "- Drive your data `useEffect` off `win`: compute `from = win.start.getTime()` and `to = win.end.getTime()` (epoch ms) and re-run EVERY query when `win` changes.",
  "- NEVER bake a window into HogQL with `now()` or a hardcoded `INTERVAL` — those ignore the picker. Compute `fromUnix = Math.floor(from / 1000)` and `toUnix = Math.floor(to / 1000)`, then write `timestamp >= toDateTime(fromUnix) AND timestamp < toDateTime(toUnix)` with those numbers interpolated (integer unix = unambiguous UTC; a bare 'YYYY-MM-DD' string would shift by the project timezone).",
  "- HALF-OPEN always: `>= from AND < to` — never an inclusive `<= to` (it double-counts the boundary).",
  "- For a prior-period comparison, use the equal-length window immediately before the current one (`prevFrom = from - (to - from)`, `prevTo = from`), so the comparison tracks the selected window length.",
  "- Bucket on the same basis as the window (`toStartOfDay` / `toStartOfHour`); never mix in `now()`.",
];

// Opinionated React rules for the "dashboard" template (a live, data-driven board).
const FREEFORM_DASHBOARD_RULES = [
  "This is a LIVE, DATA-DRIVEN dashboard built from the user's real PostHog data — not a static mockup.",
  'Open with a `Heading` title, then a responsive grid (Tailwind `className="grid gap-4"`) of Quill `Card` KPIs (raw numbers via `ph.query`), then trend charts.',
  "Visualize trends with `recharts` (LineChart for time series, BarChart for discrete categories) rather than dumping tables; show a compact `Card` KPI for single-number metrics and a `Badge` delta.",
  "Each card/chart loads its own metric via `ph.query`; show a `SkeletonText`/`Skeleton` placeholder (see LOADING) while loading or refreshing, then the value, and handle empty/error.",
  ...FREEFORM_QUILL_RULES,
  ...FREEFORM_DATE_CONTROL_RULES,
];

// Opinionated React rules for the "web-analytics" template — a PostHog-style web
// analytics board, mirroring the json-render web-analytics layout in React.
const FREEFORM_WEB_ANALYTICS_RULES = [
  'Build a PostHog-style WEB ANALYTICS board from the project\'s real data. Title it (e.g. "Web analytics") with an `<h1>` or Quill heading.',
  "LAYOUT, top to bottom: (1) a KPI row of cards — Visitors, Page views, Sessions, Session duration, Bounce rate — each with a delta vs the prior equal-length period. (2) A unique-visitors `recharts` LineChart over time with a second line for the prior period. (3) Top paths and traffic-source/channel breakdowns as tables. (4) Devices and geography tables (prefix countries with their flag emoji). Add retention / active-hours if the data supports it.",
  "WEB-ANALYTICS HogQL: Visitors = `uniq(person_id)`; Page views = `countIf(event = '$pageview')`; Sessions = `uniq($session_id)`; Bounce rate from single-pageview sessions; Channel = `properties.$channel_type`; Device = `properties.$device_type`; Country = `properties.$geoip_country_name`. Verify column names via the MCP tools if unsure.",
  "Format raw numeric values yourself for display (e.g. show 236K from 236000). Keep result sets small — aggregate in HogQL, don't fetch raw events.",
  ...FREEFORM_QUILL_RULES,
  ...FREEFORM_DATE_CONTROL_RULES,
];

const FREEFORM_SYSTEM_PROMPT = buildFreeformPrompt();

// React-tier system prompts keyed by templateId, for the freeform (React-in-iframe)
// gen path. The generic freeform sandbox is the fallback. Distinct from the
// json-render `systemPromptFor` registry: a canvas whose `kind` is "freeform"
// (see REACT_TIER_TEMPLATE_IDS) is generated from THESE, while a legacy
// json-render canvas with the same templateId still uses the catalog prompt.
const FREEFORM_SYSTEM_PROMPTS: Record<string, string> = {
  [FREEFORM_TEMPLATE_ID]: FREEFORM_SYSTEM_PROMPT,
  dashboard: buildFreeformPrompt(FREEFORM_DASHBOARD_RULES),
  "web-analytics": buildFreeformPrompt(FREEFORM_WEB_ANALYTICS_RULES),
};

// The React-tier prompt for a templateId, falling back to the generic sandbox.
export function freeformSystemPromptFor(id: string | undefined): string {
  return (
    (id ? FREEFORM_SYSTEM_PROMPTS[id] : undefined) ??
    FREEFORM_SYSTEM_PROMPTS[FREEFORM_TEMPLATE_ID]
  );
}

const FREEFORM_SUGGESTIONS: CanvasSuggestion[] = [
  {
    label: "Signups chart",
    prompt:
      "Build an app that shows daily new signups for the last 30 days as a line chart, with a total at the top.",
  },
  {
    label: "Top events",
    prompt:
      "Build an app listing the top 10 events by volume in the last 7 days, with a bar chart and a refresh button.",
  },
  {
    label: "Metric explorer",
    prompt:
      "Build a small tool with a dropdown to pick an event and a chart that shows its daily count over the last 14 days.",
  },
];

const FREEFORM_TEMPLATE: CanvasTemplate = {
  id: FREEFORM_TEMPLATE_ID,
  name: "Freeform (React)",
  description:
    "Describe anything — the agent writes a real React app that runs in a sandbox and can be shared.",
  builtIn: true,
  suggestions: FREEFORM_SUGGESTIONS,
  systemPrompt: FREEFORM_SYSTEM_PROMPT,
};

function buildTemplate(t: BuiltInTemplate): CanvasTemplate {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    builtIn: true,
    suggestions: t.suggestions,
    systemPrompt: canvasCatalogFor(t.allow).prompt({
      mode: "inline",
      system: t.system,
      customRules: [...BASE_RULES, ...t.rules],
    }),
  };
}

/** Built-in templates, keyed by id. The default ("dashboard") is first. The
 * freeform template is appended (its prompt is hand-written, not catalog-built). */
export const BUILT_IN_TEMPLATES: CanvasTemplate[] = [
  ...BUILT_INS.map(buildTemplate),
  FREEFORM_TEMPLATE,
];

export const DEFAULT_TEMPLATE_ID = "dashboard";
