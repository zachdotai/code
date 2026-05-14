# Rendering Canvas

A primitive for rendering LLM-generated React UIs inside PostHog Code, anywhere in the app.

A "canvas" is a string of React/TSX source stored in Postgres on PostHog infra. The Code app renders it inside a sandboxed iframe with React 19, Chart.js, and a controlled bridge back to the PostHog API. Canvases are created/edited by LLM agents via an MCP tool (planned) and can be attached to tasks, dashboards, sidebars, modals, or anywhere a panel fits.

## Goals

- **Persistent, team-scoped storage.** A canvas lives on PostHog infra (Postgres), behind the standard project-scoped REST surface. Same storage path for local agents (Code desktop) and cloud agents (PostHog backend).
- **Safe execution.** Untrusted LLM output runs in a null-origin iframe with a strict CSP. The host renderer is never exposed.
- **Live data.** Canvases can call the PostHog API from inside the sandbox and refetch.
- **Drop-in placement.** One component, one prop (`canvasId` or `content`), works in any container.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  PostHog backend (Django)                                   │
│    products/tasks/backend/models.py     RenderingCanvas     │
│    products/tasks/backend/api.py        RenderingCanvasVS   │
│    /api/projects/{team_id}/rendering_canvases/              │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ REST (PAT or session)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Code desktop (Electron renderer)                           │
│    PostHogAPIClient                                         │
│      .listRenderingCanvases / .getRenderingCanvas           │
│      .createRenderingCanvas / .updateRenderingCanvas        │
│      .deleteRenderingCanvas                                 │
│                                                             │
│    <RenderingCanvas canvasId="…" />  ──┐                    │
│    <CanvasRenderer content="…" />     │                     │
│                                       ▼                     │
│    ┌─────────────────────────────────────────────────────┐  │
│    │  iframe sandbox="allow-scripts" (null origin)       │  │
│    │    CSP: only esm.sh / jsdelivr / unsafe-eval        │  │
│    │    Loads React 19, Chart.js, react-chartjs-2        │  │
│    │    Compiles TSX with @babel/standalone              │  │
│    │    Executes in `new Function(...)` with scope       │  │
│    │    `api.*` calls postMessage → parent → API client  │  │
│    └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Backend: REST API

Base: `/api/projects/{team_id}/rendering_canvases/`
Auth: `Authorization: Bearer <personal_api_key>` or session cookie. Team-scoped.

### Resource

```jsonc
{
  "id": "uuid",
  "name": "string (≤200 chars)",
  "content": "string (≤256 KB, validated)",  // React/TSX source
  "task": "uuid | null",                      // optional FK to Task in same team
  "created_by": { /* UserBasic */ },
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

### Endpoints

| Method | Path                | Purpose                                          |
| ------ | ------------------- | ------------------------------------------------ |
| GET    | `/`                 | List (paginated: `limit`, `offset`)              |
| POST   | `/`                 | Create. Body: `{ name, content, task? }`         |
| GET    | `/{id}/`            | Retrieve                                         |
| PATCH  | `/{id}/`            | Partial update. Writable: `name`, `content`, `task` |
| DELETE | `/{id}/`            | Soft delete (sets `deleted=true`, returns 204)  |

Soft-deleted rows are filtered out of every read endpoint. Deleting a Task sets `canvas.task = NULL` (canvas survives).

### Content validation

`content` is rejected with `400 { type: "validation_error", code: "invalid_input", attr: "content", detail }` if any of:

- size > 256 KB
- matches forbidden pattern: `fetch(`, `XMLHttpRequest`, `eval(`, `new Function`, `import(`, `<script`, `document.write`/`document.cookie`, `window.location`/`window.open`
- contains a `{{ … }}` block whose inner expression is not `@api.<dotted.path>(<args>)`
- unmatched `{{` or `}}`

Implemented in [products/tasks/backend/rendering_canvas_validation.py](/products/tasks/backend/rendering_canvas_validation.py).

## Frontend: client

[apps/code/src/renderer/api/posthogClient.ts](apps/code/src/renderer/api/posthogClient.ts)

```ts
client.listRenderingCanvases({ limit, offset });    // → PaginatedRenderingCanvases
client.getRenderingCanvas(id);                       // → RenderingCanvas
client.createRenderingCanvas({ name, content, task });
client.updateRenderingCanvas(id, partial);
client.deleteRenderingCanvas(id);
```

Same auth/refresh as every other PostHog API call (uses the shared fetcher).

## Frontend: primitives

[apps/code/src/renderer/features/rendering-canvas/](apps/code/src/renderer/features/rendering-canvas/)

### `<RenderingCanvas canvasId={…} />`

High-level: fetches by ID, caches via React Query, auto-wires the `api.*` bridge to the existing `PostHogAPIClient`.

```tsx
<RenderingCanvas canvasId={id} className="h-64" />
```

| Prop        | Type                                              | Purpose                                            |
| ----------- | ------------------------------------------------- | -------------------------------------------------- |
| `canvasId`  | `string`                                          | UUID of a canvas in the current team               |
| `onApiCall` | `(path, args) => Promise<unknown>` (optional)     | Override the default API resolver                  |
| `className` | `string`                                          | Forwarded to the iframe                            |
| `style`     | `CSSProperties`                                   | Forwarded to the iframe                            |

### `<CanvasRenderer content={…} />`

Low-level: pure component. Takes raw TSX and an optional API resolver. Use for previews, drafts, custom resolution.

```tsx
<CanvasRenderer
  content={tsxString}
  onApiCall={async (path, args) => /* resolve */}
  onReady={() => …}
  onError={(msg) => …}
/>
```

## Runtime contract (what the canvas can use)

The canvas runs inside a sandboxed iframe. It does not use `import` statements — the runtime provides everything as in-scope globals. The canvas **must export a component named `App`** (or default).

### Available globals

| Name | What |
| --- | --- |
| `React` | React 19 namespace |
| `useState`, `useEffect`, `useCallback`, `useMemo`, `useRef` | React hooks |
| `api` | Proxy: `api.foo.bar(arg)` → resolved by host via postMessage. Returns a Promise. |
| `useApi(path, args?, deps?)` | Hook: `{ data, loading, error, refetch }`. Re-runs on `deps`. |
| `Chart`, `Chartjs` | Raw Chart.js (registered with `auto`) |
| `Line`, `Bar`, `Pie`, `Doughnut`, `Radar`, `PolarArea`, `Bubble`, `Scatter` | `react-chartjs-2` components |
| `PageHeader`, `Section`, `KpiRow`, `Kpi`, `EmptyState`, `ErrorState` | PostHog-themed primitives — see below |
| `chartTheme(overrides?)` | Chart.js options preset using `--gray-N` for axes/grid/labels |
| `tokens` | JS object of every CSS var injected on `:root` (e.g. `tokens["--orange-9"]`) for cases where `var()` doesn't fit (Chart.js series colors, canvas2d, etc.) |

### Theme & primitives

The host injects PostHog's design tokens (`--gray-1..12`, `--orange-1..12`, `--red-*`, `--green-*`, `--blue-*`, `--yellow-*`, `--accent-*`, `--radius-*`, `--font-size-*`, `--font-sans`) onto the iframe's `:root` from the live host stylesheet. Theme changes in the host rebuild the srcDoc. Prefer `style={{ color: "var(--gray-12)" }}` over hex literals.

Primitive API:

```tsx
<PageHeader
  title="Product analytics"
  subtitle="Last 30 days"
  action={<button onClick={refetch}>Refresh</button>}
/>

<KpiRow>
  <Kpi label="WAU" value="12.4k" hint="last 7 days" />
  <Kpi label="WoW change" value="+8.2%" hint="vs prior week" tone="positive" />
  <Kpi label="Errors" value="142" tone="negative" />
</KpiRow>

<Section title="Daily active users">
  <div style={{ height: 220 }}>
    <Line data={…} options={chartTheme()} />
  </div>
</Section>

{rows.length === 0 ? <EmptyState>No events.</EmptyState> : …}
{error && <ErrorState>{error.message}</ErrorState>}
```

`Kpi`'s `tone` accepts `"neutral"` (default), `"positive"`, `"negative"`, `"brand"`.

### Example canvas

```tsx
function App() {
  const { data, loading, refetch } = useApi("getTasks", [{ internal: false }]);
  if (loading) return <p>Loading…</p>;
  return (
    <div>
      <button onClick={refetch}>Reload</button>
      <Bar
        data={{
          labels: data.map((t) => t.title),
          datasets: [{ data: data.map((t) => t.run_count) }],
        }}
      />
    </div>
  );
}
```

### API bridge

`api.<segment>.<segment>(...args)` posts `{ kind: "canvas:api", id, path: "segment.segment", args }` to the parent. The host's `onApiCall(path, args)` resolves and posts back `{ kind: "canvas:api-result", id, result | error }`.

Default resolver in `<RenderingCanvas>` walks dotted paths against `PostHogAPIClient`, so any client method is callable as `api.<methodName>(...)`. Custom `onApiCall` can restrict, mock, or redirect.

## Security model

| Layer                                          | What it blocks                                      |
| ---------------------------------------------- | --------------------------------------------------- |
| Backend `validate_canvas_content`              | `fetch`, `eval`, `import()`, `<script>`, `window.*`, malformed `{{ }}` |
| `<iframe sandbox="allow-scripts">`             | No same-origin access, no forms, no top-nav, no popups, null origin |
| Iframe CSP                                     | `default-src 'none'`; only `esm.sh` + `jsdelivr` for scripts/styles; `connect-src` same |
| postMessage bridge                             | Only the parent can resolve `api.*` — canvas has no other route to data |
| No `nodeIntegration`, no `allow-same-origin`   | Canvas cannot reach Node, Electron, or the parent renderer |

`'unsafe-eval'` is intentionally enabled in the iframe CSP because Babel compiles TSX at runtime via `new Function`. This is contained to the sandbox.

## Integration patterns

```tsx
// 1. Inline in a panel
<div className="flex-1 min-h-0">
  <RenderingCanvas canvasId={canvasId} />
</div>

// 2. Modal preview
<Dialog.Content style={{ height: 520, padding: 0 }}>
  <RenderingCanvas canvasId={canvasId} />
</Dialog.Content>

// 3. Live editor preview (uncommitted draft)
<CanvasRenderer content={draftTsx} onError={setCompileError} />

// 4. List of canvases attached to a task
const { data } = useQuery(["canvases", taskId], () =>
  client.listRenderingCanvases({ /* TODO: server-side task filter */ })
);

// 5. Restricted resolver
<CanvasRenderer
  content={tsx}
  onApiCall={async (path, args) => {
    if (!ALLOWED.has(path)) throw new Error(`Forbidden: ${path}`);
    return (client as any)[path](...args);
  }}
/>
```

## How LLMs create canvases

**Cloud agents** (running on PostHog backend): the MCP `create_ui` / `edit_ui` tools hit the REST endpoints directly via the internal service. Storage is local.

**Local agents** (running in Code desktop): two viable paths —

1. **Hosted MCP** — local agent points at PostHog's hosted MCP server using the user's PAT. Same code path as cloud. Recommended default.
2. **Local MCP shim** — the Code app exposes the MCP tool in-process and proxies through `PostHogAPIClient`. Adds a seam for optimistic local preview before the server roundtrip. More code; only worth it if we need the seam.

Either way, the canonical store is the REST API; the Code app reads back via `getRenderingCanvas`.

## Files

| Layer       | Path                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------- |
| Model       | `products/tasks/backend/models.py` → `RenderingCanvas`                                        |
| Validation  | `products/tasks/backend/rendering_canvas_validation.py`                                       |
| Serializer  | `products/tasks/backend/serializers.py` → `RenderingCanvasSerializer`                         |
| ViewSet     | `products/tasks/backend/api.py` → `RenderingCanvasViewSet`                                    |
| URL         | `posthog/api/__init__.py` → registered as `rendering_canvases`                                |
| API client  | `apps/code/src/renderer/api/posthogClient.ts` → `*RenderingCanvas*` methods                   |
| Pure UI     | `apps/code/src/renderer/features/rendering-canvas/CanvasRenderer.tsx`                         |
| ID wrapper  | `apps/code/src/renderer/features/rendering-canvas/RenderingCanvas.tsx`                        |
| Iframe runtime | `apps/code/src/renderer/features/rendering-canvas/runtime.ts`                              |
| Demo button | `apps/code/src/renderer/features/rendering-canvas/TestCanvasButton.tsx`                       |
| Demo stub   | `apps/code/src/renderer/features/rendering-canvas/test-canvas-stub.tsx`                       |

## Open questions

1. **`{{ @api.* }}` templating.** The backend validates this syntax, but the frontend currently expects real `api.*()` calls in canvas source. Do we want a server-side pre-pass that rewrites templates → real calls, or should the frontend transform templates before compilation?
2. **Offline / bundled deps.** The iframe loads React/Chart.js/Babel from `esm.sh` at runtime. Worth bundling them into a renderer-served asset for offline support and faster cold starts?
3. **Tasks list filter.** Listing canvases by `task` isn't a documented query param yet. Add `?task=<uuid>` filter to the ViewSet?
4. **Realtime updates.** Spec says no SSE for canvases. If two agents edit the same canvas, last write wins. Acceptable for v1?
5. **Versioning.** Should `PATCH` keep a history, or is the soft-delete + recreate pattern enough?
6. **Permission scopes.** Currently `scope_object = "task"` reuses Task permissions. Worth a dedicated `canvas` scope?
