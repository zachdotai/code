# Canvas templates, open-ended building & data sources — design scope

**Status:** Phase 1 shipped; Phases 2–6 scoped below.
**Owner:** canvas feature.
**Branch:** `feat/canvases-rename` (builds on `feat/canvas` → `feat/canvas-quill`).

## Vision

A **canvas** is a freeform, agent-built surface — not a PostHog dashboard. At
creation the user picks a **template** that injects its own agent context
(prompt + component palette + data policy + optional starter spec). "Dashboard"
becomes _one_ template; "Blank canvas" can become anything the user describes —
a tool, a form, a whole mini-site. Data is not limited to product analytics: the
agent can pull from any connected PostHog **data-warehouse source** (Stripe,
Postgres, …) via HogQL.

The rigid, PostHog-data-centric gen-UI is being generalised into a
template-driven, source-aware canvas builder.

## Locked decisions

1. **Catalog + prompt move to main.** The component contract and the agent
   system prompt are business logic; they leave the renderer.
2. **Blank canvas = curated palette + sanitized rich text.** No arbitrary
   `<script>`; "website" means composing many sanitized sections, not raw markup.
3. **Design for user-defined templates from the start.** Templates are data
   (records), not hardcoded. Built-ins are seeded; users can add their own later.
4. **New warehouse sources: link out to PostHog.** We surface available/connected
   sources and deep-link to PostHog to connect new ones — no in-app OAuth.
5. **Both built-in templates are Declarative.** See the stance below.

## Generative-UI stance: Controlled / Declarative / Open-ended

Prior art: Shubham Saboo's "three patterns of Generative UI" (controlled →
declarative → open-ended; CopilotKit / AG-UI / A2UI).

- **Controlled** — pre-built components bound to tool names; the agent picks
  which to render. Pixel-perfect but pays a per-turn token tax (~400 tok per
  registered component) and mis-picks past ~25.
- **Declarative** — the agent emits a **schema**; the app maps it to a **catalog**
  of components with typed props. One tool, many UIs, flat token cost. The
  pattern "built for the long tail: dashboards, results, forms, cards, widgets."
- **Open-ended** — no catalog; the agent writes **raw HTML in a sandboxed
  iframe**. Maximal freedom, but brand drift and brittleness — "never as the
  primary surface," only for disposable/one-shot output.

**Our canvas is Declarative** (json-render schema → shared catalog → React
bodies with Zod props). That's deliberate and stays the model for BOTH built-in
templates:

- **Dashboard** — Declarative, data-focused catalog (Stat/charts/Table + refresh).
- **Blank** — Declarative, _broader_ catalog (Hero/Section/Markdown/Button/tones)
  + a looser prompt. NOT open-ended: saved canvases are primary, reopenable,
  branded surfaces, so they must stay editable, on-brand, dark-mode-safe, and
  data-bindable.
- **Interactivity** (forms, buttons that _do_ things) is pursued the declarative
  way: **actions in the schema** that fire an event back to the agent
  (json-render already supports `on`/actions + bindings) — not by going
  open-ended.
- **Open-ended** is reserved for a possible future _disposable_ "quick sketch"
  mode (a throwaway viz in chat), never the default for a saved canvas.

## Current state (what we're changing)

- One hardcoded `CANVAS_SYSTEM_PROMPT` and one `canvasCatalog`, both in the
  renderer (`genui/catalog.ts`), passed to the agent at session start.
- `canvas-gen` main service owns the agent session: `bypassPermissions`,
  `repoPath = tmpdir`, `disallowedTools = [Bash, Write, Edit, MultiEdit,
  NotebookEdit, WebFetch, WebSearch]`. The agent is read-only and can only reach
  **PostHog MCP tools** (`mcp.posthog.com/mcp`).
- A canvas record is `{ id, channelId, name, spec }` (desktop-fs `meta` blob).
  No template or data-source field.
- Warehouse data is **already queryable via HogQL** (the `dashboard-query`
  refresh path runs HogQL; the MCP exposes `data-warehouse` / `external-data` /
  `execute-sql` domains). The gap is _discoverability_ and _UI_, not reachability.

## The model

### `CanvasTemplate` (data, main-owned)

```ts
interface CanvasTemplate {
  id: string;                 // "dashboard" | "blank" | <user-defined uuid>
  name: string;
  description: string;        // shown in the create picker
  builtIn: boolean;           // seeded vs user-created
  systemPrompt: string;       // agent context injection (per-template)
  catalogId: string;          // which component palette the agent may emit
  starterSpec?: Spec;         // optional scaffold rendered before the first turn
  dataPolicy: DataPolicy;     // which sources the agent may query
  createdAt: number;
  updatedAt: number;
}
```

- Templates are **records**, served by a `CanvasTemplatesService` (main),
  exposed via a one-line tRPC router. Built-ins ("dashboard", "blank") are seeded
  on first run; user templates persist alongside (same store as canvases, or a
  dedicated templates store — see Open questions).
- Today's `CANVAS_SYSTEM_PROMPT` + `canvasCatalog` become the **Dashboard**
  template: cards, charts, Stats, refresh buttons, PostHog-data-centric.
- **Blank** template: looser prompt ("build whatever the user asks"), a wider
  curated palette (layout primitives + sanitized rich-text/markdown block).

### Context injection

- A canvas stores `templateId`. `canvas-gen.generate` resolves the template's
  `systemPrompt` at **session start** (the agent's system prompt is frozen
  there).
- Per-turn we keep injecting the canvas title (already done) **plus a
  data-source manifest** (below), so the agent always knows what it can pull.

### Data sources & the warehouse

- Add a main method to **list warehouse sources/tables** for the project
  (PostHog `external_data` / warehouse API).
- Inject a compact **manifest** into the agent context, e.g.
  `Available data: events, persons, stripe_invoices(customer_id, amount, created)…`
  so the agent writes correct HogQL against Stripe et al.
- Warehouse-backed Stat refresh reuses the existing `dashboard-query` HogQL
  path — no new mechanism.
- Connecting a _new_ source is a PostHog-side flow: surface status and
  **deep-link to PostHog** (decision 4). No in-app OAuth.

## Architecture by layer (per CLAUDE.md)

| Layer      | Change |
| ---------- | ------ |
| **shared** | The component **catalog contract** — names, Zod prop schemas, descriptions — moves to a shared module so one source feeds both the renderer registry and the main prompt builder. |
| **main**   | New `CanvasTemplatesService` (list/get/create templates; compute `systemPrompt`). The `catalog.prompt()` generation moves to main. `canvas-gen.generate` takes a `templateId` and resolves prompt + catalog + data manifest. New warehouse-sources listing method (on a data service). Routers stay one-liners (R10). |
| **renderer** | Template **picker** at create. `genui/registry.tsx` keeps mapping catalog component names → React bodies (it imports the shared contract). Thin tRPC calls only — no prompt/catalog logic left here. |

**Catalog split (decision 1):** the _contract_ (what components exist + their
prop schemas) is shared so the renderer can render it; the _prompt text_
(`catalog.prompt(...)`) is generated in main as part of each template. The
renderer no longer constructs or passes `CANVAS_SYSTEM_PROMPT`.

## Blank canvas — rendering & safety (decision 2)

- Blank gets a **broader curated palette** (more layout/content primitives) plus
  a **sanitized** markdown/rich-text block (we already depend on
  `rehype-sanitize`).
- **No arbitrary `<script>`.** The agent's _tools_ are sandboxed, but its
  _rendered output_ runs in our renderer — raw HTML/iframe is an
  XSS/exfiltration surface, deferred and gated.
- "Whole website" = composing many sanitized sections/components, not
  unrestricted markup.
- Interactivity (forms/buttons that _do_ things) → json-render already has
  `actions`/bindings; treat as a deliberate later phase with its own review.

## Data model / storage

- Add `templateId: string` (default `"dashboard"` for back-compat) and optional
  `dataSources?: string[]` to the canvas record + fs-meta schema. Existing boards
  read as the Dashboard template.
- Templates persisted as records (built-ins seeded; user templates addable).

## The static-renderer constraint (learned in Phase 1)

The canvas renderer (`genui/EditRenderer.tsx` + `bodies.tsx`) is a **static
walk**. It does NOT resolve any json-render dynamic feature: no top-level
`state` model, no `repeat`, no `visible`, no `on`/actions, and no binding
objects (`{$state}`, `{$item}`, `{$bindItem}`, `{$index}`) in props. A binding
object placed in a prop used to crash the whole canvas to "Rendering…"; it now
degrades to empty via `asText()`, and the schema mirror + template rules tell
the agent to emit static content only.

This is load-bearing: it keeps us firmly in **Declarative-static** today. The
path to interactivity is NOT open-ended HTML — it's making the renderer resolve
json-render's _declarative_ dynamic features (`on`/actions + bindings), so a
button in the schema can fire an event back to the agent (the A2UI model). Treat
that as Phase 2.5 below; it stays declarative and on-brand.

## Phasing

### Phase 1 — Template plumbing ✅ done

- `@shared/canvas`: component contract + core-only schema mirror (no React in
  main). One source for the renderer registry and the main prompt builder.
- `CanvasTemplatesService` (main): built-in **Dashboard** + **Blank** templates,
  record-shaped (`builtIn`, `suggestions`, `systemPrompt`) for future
  user-defined ones. Prompt generated in main; `canvas-gen.generate` takes a
  `templateId`.
- `templateId` on canvas records (default `"dashboard"`, back-compat).
- Renderer: thread carries `templateId`; `NewCanvasMenu` picker at create;
  per-template chat **suggestions** (chips that fill + focus the composer, shown
  only while the canvas is empty).
- Hardening: static-only schema/rules + `asText()` so stray bindings can't crash
  the canvas.

### Phase 2 — Blank palette (partly done)

- ✅ Widened the catalog: `Hero` (centered hero section), `Markdown` (sanitized
  rich-text via `rehype-sanitize`, no `<script>`), `Button` (display CTA). Blank
  template nudges the agent to use them for rich pages.
- ⬜ Catalog packaging / allow-list (see open questions): one contract +
  per-template allow-list (leaning) so a template constrains which components the
  agent may emit. Currently all templates can emit everything.

### Phase 2.5 — Declarative interactivity (gates forms/tools)

- Teach the renderer json-render's _declarative_ dynamic features: resolve
  `{$state}`/`{$item}` bindings, `repeat`, `visible`, and wire `on`/actions so a
  schema button fires an event back to the agent (the A2UI model). Likely use
  `createRenderer` for view mode and resolve bindings in the edit walk; relax the
  "static only" rules per-template once supported.
- This stays Declarative — NOT open-ended HTML. Required before forms/tools that
  hold state or react to clicks.

### Phase 3 — Source @mentions (data sources)

Prior art: **Craft Agents' "sources"** (craft-ai-agents/craft-agents-oss) — a
conversational abstraction where users `@mention` a source mid-chat and the
agent gains its tools/schema, no restart. We adopt the *@mention* UX, not their
connection layer: PostHog's Data Warehouse already owns connecting Stripe /
Postgres / etc., and the canvas agent is hard-sandboxed (read-only), so we skip
their in-chat OAuth and permission modes.

- Main method to list the project's queryable sources (product-analytics
  `events`/`persons` + warehouse tables via `external_data`). Expose for an
  `@mention` autocomplete in the chat composer.
- The user `@`-references the sources they want (`@events`, `@stripe_invoices`);
  ONLY those table schemas are injected into the agent context (token-cheap,
  precise) — instead of dumping the whole warehouse manifest. With no mention,
  fall back to a small default set (events/persons).
- Mentioned sources are recorded on the canvas's `dataSources` field (already
  scoped) so the board remembers what it's built on. Warehouse-backed Stat
  refresh reuses the existing `dashboard-query` HogQL path.

### Phase 4 — Data UI

- Surface a canvas's attached sources (from `dataSources`) and the `@mention`
  picker in the composer; **link out to PostHog** to connect new warehouse
  sources (no in-app OAuth); surface warehouse-backed refresh in the UI.

### Phase 5 — User-defined templates

- UI to save the current canvas (system prompt + palette/allow-list + starter
  spec + suggestions) as a reusable template. `CanvasTemplatesService` is already
  record-shaped; add a writable store (built-ins stay read-only).

### Phase 6 — Later

- Real interactivity/actions (depends on Phase 2.5), template sharing, more
  built-in templates.
- **Open-ended "quick sketch" mode** (optional): a third `renderMode` for
  _disposable_, throwaway visualizations — agent writes sanitized HTML in a
  sandboxed iframe (`sandbox="allow-scripts allow-forms"`, never
  `allow-same-origin`). Per the prior art, this is NEVER the default for a saved
  canvas — only an explicit, ephemeral surface.

## Cross-cutting follow-ups (not phase-gated)

- ✅ **Reloaded-board append-only seeding**: `canvas-gen.generate` now takes the
  canvas's `currentSpec`; the thread's `state.spec` is seeded from it at session
  start, and the agent prompt includes the current spec so it appends against
  real element keys instead of rebuilding from empty.
- **Chart tooltip vars**: `--color-bg-surface-*` / `--color-text-primary-inverse`
  aren't in beta.14 quill CSS → tooltip styling falls back.
- **vitest can't import `quill-charts`** (dayjs subpath) → add a resolve alias if
  we want body unit tests.

## Open questions

- **Template store:** reuse the canvases desktop-fs store (a `type: template`
  row) or a dedicated store? (Leaning: same desktop-fs backend, distinct type.)
- **Catalog packaging:** one shared catalog with per-template _allow-lists_, or
  fully separate catalogs per template? (Leaning: one contract, per-template
  allow-list, so the renderer registry stays single-source.)
- **Per-template tool gating:** should Blank get a different `disallowedTools`
  set than Dashboard? (Default: keep the read-only sandbox for all.)
- **Data manifest size:** cap/scope the injected warehouse schema for large
  projects to avoid blowing the context.

## Resolved decisions

- **Render mode (resolved):** both built-in templates are **Declarative**.
  Blank is _not_ open-ended — saved canvases are primary surfaces, so they stay
  declarative (editable, on-brand, data-bindable). Open-ended is reserved for a
  future disposable mode only (Phase 6).
- **Interactivity (resolved):** pursued declaratively via schema `on`/actions
  (Phase 2.5), not raw HTML.

## Related

- Component contract & renderer: `genui/catalog.ts`, `genui/registry.tsx`,
  `genui/bodies.tsx`.
- Agent session: `main/services/canvas-gen/service.ts`.
- Refresh / HogQL: `main/services/dashboard-query/service.ts`.
- Storage: `main/services/dashboards/{schemas,service}.ts`.
- Conventions: `features/canvas/AGENTS.md`.
