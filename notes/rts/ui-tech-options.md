# Hedgemony — UI tech options

> **Note on context.** This doc was originally drafted against the PostHog SaaS web app at `~/dev/posthog` (React 18 + Kea + Tailwind, served from a CDN, OSS-shippable). The actual Hedgemony host is `posthog-code` (Electron + React 19 + Radix + Zustand + Tailwind v4, distributed as a desktop app, not OSS-served). Several conclusions shift in the Electron context — see the **Synthesis** section at the bottom. Mentions of Kea, `GlobalModals.tsx`, `frontend/src/`, OSS-shippability, COOP/COEP, and bundle-size-on-the-wire all need to be re-read against an Electron app where assets ship inside the installer.

Quick survey of technical approaches for adding a game-style ("Godot-esque", AgentCraft-inspired) UI surface for Hedgemony. The ask is ambiguous on purpose — "Godot UI" can mean (a) literally embedding the Godot engine (HTML5/WASM export), or (b) a game-aesthetic UI built in web tech. Options below cover both readings.

## Existing constraints worth pinning down up front

- Frontend is React 18 + Kea + Tailwind, esbuild-bundled, with Vite available as an alternate dev server. Entry: `frontend/src/index.tsx`; auth shell mounts in `frontend/src/scenes/AuthenticatedShell.tsx:39`.
- A precedent overlay already exists: `@posthog/hedgehog-mode@0.0.48` (Pixi.js 8 + matter-js physics), mounted globally as a `position: fixed; z-index: 999998` canvas in `frontend/src/lib/components/HedgehogMode/HedgehogMode.tsx:75-87`, wired via `GlobalModals` in `frontend/src/layout/GlobalModals.tsx:81`, with a Kea logic at `frontend/src/lib/components/HedgehogMode/hedgehogModeLogic.ts`. The overlay reads DOM platforms via a CSS selector list — that's the model for "game thing that knows about the React UI."
- Assets are served from `/static/hedgehog-mode` (see `getHedgehogModeAssetsUrl` at `HedgehogMode.tsx:18-31`). Any new option needs an equivalent asset-serving story.
- There's a `products/games/` workspace (`@posthog/products-games`) hosting full-page games (e.g. FlappyHog at `products/games/FlappyHog/FlappyHog.tsx`). Precedent for a game living inside the SPA at its own route, not as an overlay.
- Lazy-load pattern: hedgehog renderer is `React.lazy(() => import('@posthog/hedgehog-mode'))` with `Suspense` — keeps the engine out of the main bundle. Every option below should follow the same pattern.

## Options

### Option 1 — Extend `@posthog/hedgehog-mode` with new scenes

**What it is.** Treat hedgehog-mode as the game framework and add new "scenes" (a Warcraft-3-ish HUD, unit panels, minimap, dialog) inside it. Pixi.js 8 is already the renderer; matter-js is already there for physics. Integration with Kea/React stays identical to today — one global lazy-mounted overlay, configured by a Kea logic. Likely requires upstream changes in the separate `@posthog/hedgehog-mode` repo (see `node_modules/.pnpm/@posthog+hedgehog-mode@0.0.48`).

**Pros.**
- Zero new deps in the PostHog repo; no bundle-size hit beyond what's already shipping.
- Mount/teardown plumbing, asset CDN path, dark/light theming, and Kea wiring all exist (`HedgehogMode.tsx`).
- The DOM-platform selector pattern is reusable for "AgentCraft units stand on top of LemonButtons."
- Conceptually consistent with how PostHog already treats game overlays.

**Cons.**
- Pixi is 2D — rules out true "Godot 3D" aesthetic.
- Requires landing changes in a separate package; iteration loop is slower than in-repo.
- Hedgehog-mode's API surface is small and probably opinionated toward a hedgehog sprite; adding RTS-style selection / unit groups may push beyond what it's designed for.
- Visual ceiling is bounded by Pixi 2D sprite work.

**Effort signal.** Medium. Hard parts: figuring out the upstream package's plugin/scene API (it may not have one — could require fork or PR), building the sprite/animation set, and exposing Kea-readable state out of the Pixi loop.

**Open questions.**
- Does `@posthog/hedgehog-mode` expose a scene/plugin API, or is it monolithic? Read its source in the npm tarball.
- Who owns the upstream repo and what's the merge cadence?
- Can sprites be loaded dynamically (so PostHog data can drive what "units" appear) or is the sprite atlas baked in?

### Option 2 — Pixi.js scenes directly (skip the hedgehog-mode wrapper)

**What it is.** Add Pixi.js 8 directly to the frontend (already transitively present at `node_modules/.pnpm/pixi.js@8.14.3`) and build a new overlay component that mounts its own canvas. Pattern follows `HedgehogMode.tsx` but without depending on the hedgehog package — same `position: fixed`, same lazy import, own Kea logic.

**Pros.**
- Full control of the render loop, scene graph, asset pipeline — no upstream blocker.
- Pixi 8 has WebGPU support; visuals can be sharper than the existing hedgehog overlay.
- Bundle-size cost is small marginal — Pixi is already in the dep tree.
- The existing hedgehog `selector` trick (read DOM rects, place sprites on platforms) is easy to copy verbatim.

**Cons.**
- You rebuild the input/animation/scene-management primitives that hedgehog-mode already solved.
- Two Pixi-based overlays in the same app means two `<canvas>` elements, two render loops, two asset bundles — wasteful if both ship.
- Still 2D only.
- No physics unless you wire matter-js again.

**Effort signal.** Medium. Hard parts: scene management, asset loading/serving (need a static-assets story similar to `/static/hedgehog-mode`), and the Kea↔Pixi state bridge.

**Open questions.**
- Should this co-exist with hedgehog-mode or replace it under one shared canvas?
- Is `pixi.js` a direct or transitive dep right now? (`grep pixi.js frontend/package.json` returns no direct entry; it ships via hedgehog-mode.) Promote to direct dep if used.
- What's the dark/light theming story for the sprite atlas?

### Option 3 — Three.js (or react-three-fiber) overlay — the AgentCraft clone

**What it is.** Add `three` + `@react-three/fiber` + `@react-three/drei`, mount a `<Canvas>` overlay in `GlobalModals.tsx`, expose state via Kea. AgentCraft uses raw three.js + React; r3f is the idiomatic React wrapper and lets the scene tree be JSX components that subscribe to Kea selectors with `useValues`. WebGL2 by default; WebGPU is experimental in three but possible.

**Pros.**
- True 3D — closest visual match to AgentCraft's Warcraft-3 look.
- r3f makes it trivial to bind scene-graph nodes to Kea state declaratively.
- Massive ecosystem (drei, postprocessing, cannon-es / rapier for physics, gltf loader pipeline).
- Plays well with React 18 + Suspense for asset streaming.

**Cons.**
- Net-new heavy dep (three core is ~600 KB min, r3f and drei add more). Has to be code-split.
- 3D asset pipeline (glTF/glb, textures, animations) is a real project — closer to game-dev workflow than the rest of the PostHog frontend.
- Memory / GPU cost on background tabs; need an idle/throttle policy that the current hedgehog overlay doesn't worry about.
- Perf budget on lower-end laptops is real — risk of fan-spinning regressions for a feature most users won't enable.

**Effort signal.** Large. Hard parts: the 3D asset pipeline, the perf/idle story, and the design work (sourcing or building glTF models).

**Open questions.**
- Do we have or can we license a Warcraft-3-style 3D asset pack we can ship publicly (this is an OSS repo)?
- Is `react-three-fiber` happy under Kea's React 18 + Suspense + lazy load setup? (Should be — but verify.)
- WebGL vs WebGPU — does PostHog's browser support matrix allow WebGPU as a progressive enhancement?

### Option 4 — Babylon.js overlay

**What it is.** Same shape as Option 3 but with Babylon.js instead of three. Babylon ships with built-in physics, a node-material editor, a GUI toolkit, and first-class WebGPU. Could be mounted directly or via `babylonjs-react` style wrappers.

**Pros.**
- Batteries-included engine: physics, GUI, animation system, inspector tools all in-package.
- WebGPU support is more mature than three's.
- TypeScript-native API, ergonomic for the rest of the PostHog frontend stack.
- Good documentation and a playground for prototyping.

**Cons.**
- Less common in React-heavy stacks than three/r3f — fewer community React bindings.
- Bigger core bundle than three (~1 MB min); aggressive tree-shaking matters.
- New dep with no precedent in the PostHog tree.
- Smaller talent pool internally if anyone other than the original author needs to maintain it.

**Effort signal.** Large. Hard parts: same as three (asset pipeline, perf), plus the unfamiliarity tax — fewer engineers in the org have shipped Babylon.

**Open questions.**
- Anyone at PostHog who has Babylon production experience?
- How does Babylon's GUI overlay interact with the existing Tailwind/React DOM (z-index conflicts, hit-testing)?
- Bundle size after tree-shake for the subset we'd actually use?

### Option 5 — PlayCanvas (React component or bare engine)

**What it is.** PlayCanvas Engine is an open-source WebGL/WebGPU engine, MIT-licensed, with a smaller core than three or Babylon and an entity-component model close to Unity/Godot. Mount a `<canvas>` and drive it from Kea. There's also a hosted editor (proprietary) but we'd skip it and use the open-source engine only.

**Pros.**
- Entity-component model maps well to "AgentCraft units as game-objects bound to Kea state."
- Smaller engine core than Babylon; competitive with three.
- WebGPU support is shipping.
- Good runtime perf, used by published browser games.

**Cons.**
- Smaller React community than three/Babylon — fewer copy-paste examples.
- Asset pipeline still required (glTF + textures).
- If the team later wants the PlayCanvas editor, it's proprietary/SaaS — license question.
- Adds a new heavy dep with no precedent.

**Effort signal.** Large. Hard parts: same 3D asset pipeline questions as three/Babylon, plus PlayCanvas-specific bindings to Kea.

**Open questions.**
- Engine bundle size after tree-shake?
- Is the open-source engine alone enough, or does productive work need the hosted editor?
- Active community / release cadence today?

### Option 6 — Godot HTML5 (WASM) embedded as an `<iframe>` or canvas, postMessage bridge

**What it is.** Build the game UI inside the actual Godot editor (GDScript or C#), export to HTML5 (WASM + WebGL2), and embed the resulting bundle inside PostHog as either an iframe (sandboxed, served from `/static/godot-ui/index.html`) or a direct canvas mount. State sync goes through `window.postMessage` (iframe) or Godot's `JavaScriptBridge` singleton (direct), with a Kea logic on the React side translating events to/from Godot.

**Pros.**
- The most literal reading of "Godot UI" — anything you can build in Godot, you can ship.
- Game development happens in the Godot editor, not in React/Tailwind — much faster iteration for game-ish work.
- Decoupled: Godot bundle versions independently of the PostHog deploy.
- Mature editor + asset pipeline + animation tooling out of the box.

**Cons.**
- Godot HTML5 export is heavy: WASM blob ~30-40 MB even after gzip is several MB. Must be lazy-loaded behind a feature flag, and even then it's the biggest single asset on the page.
- Bridging is awkward — every cross-boundary call is JSON over postMessage or `JavaScriptBridge.eval`. Synchronous reads of Kea state are not possible; everything is event-driven.
- COOP/COEP / SharedArrayBuffer requirements for threaded WASM exports may conflict with the rest of PostHog's headers.
- Two engineering disciplines (web + Godot/GDScript) in one feature — niche skill set.
- Asset hosting story is new (need to serve the WASM with the right MIME and headers).

**Effort signal.** Large. Hard parts: the postMessage protocol design (state schema, debouncing), COOP/COEP and CSP header coordination, and the Godot-side build pipeline in CI.

**Open questions.**
- Threaded vs single-threaded Godot HTML5 export — is the perf delta worth the COOP/COEP coordination?
- Is there a way to share authentication / API access from React into Godot, or is Godot purely a render surface fed by React?
- Does Godot 4.x have a stable JS bridge, or has the API changed across point releases?

### Option 7 — Bevy / Rust → WASM

**What it is.** Same shape as Option 6 but the engine is Bevy (Rust ECS engine) compiled to WASM and embedded. Bevy renders via wgpu (WebGPU with WebGL2 fallback). State sync to React via `wasm-bindgen` boundary calls and/or a message bus.

**Pros.**
- Rust ECS is genuinely fast and a good match for "lots of units on screen" RTS aesthetics.
- WASM bundle can be smaller than Godot's because you only pay for what you import.
- Shares dev DNA with other Rust-in-the-stack pieces (PostHog has Rust services).
- Modern engine with active community.

**Cons.**
- Bevy is pre-1.0; breaking changes between minor versions.
- Web target is real but less polished than Bevy's native target — expect rough edges.
- Few engineers can ship UI-grade Bevy; talent pool is smaller than Godot's.
- Rust build added to the frontend CI pipeline — meaningful complexity.

**Effort signal.** Large. Hard parts: Bevy web build maturity, the wasm-bindgen boundary design, and the Rust toolchain in frontend CI.

**Open questions.**
- Current state of `bevy_web` / WebGPU on Safari?
- Can `cargo-component` / `wasm-bindgen` produce a small enough bundle for what we want?
- Hot-reload story for iteration speed?

### Option 8 — CSS/SVG/HTML "fake game UI" — no canvas at all

**What it is.** Build the Warcraft-3 / AgentCraft aesthetic in plain HTML + Tailwind + SVG + CSS animations. Pixel-art frames as PNG sprites positioned absolutely; unit panels as `<div>`s with hand-drawn borders; "minimap" as a styled component reading from Kea. No WebGL anywhere.

**Pros.**
- Zero new runtime deps. Bundle-size impact is image assets only.
- Trivially data-bindable — every "game" element is a React component reading Kea selectors directly.
- Accessibility, theming (dark/light), and responsive layout work for free.
- Easy to test (Jest + Storybook already in repo).
- Lowest perf cost on user machines; no GPU loop.

**Cons.**
- Visual ceiling is low — looks like a styled web app, not a game. The "wow" factor people associate with Godot/AgentCraft mostly comes from a real engine.
- Animations are CSS keyframes / Framer Motion — fine for sprite blinking, painful for "unit walks across the screen with pathfinding."
- No physics, no real-time scene graph.
- If the ambition is RTS-style interaction (drag-select units, fog of war), CSS/SVG will fight you.

**Effort signal.** Small to medium. Hard parts: sourcing/commissioning pixel-art assets that hold up at this scale, and the design discipline to make HTML look game-like.

**Open questions.**
- Where on the spectrum is the actual ask — is the UI doing *interactive* game things (selecting units, issuing commands) or just *decorative* game things (a HUD framing the real PostHog UI)? Decorative ask collapses neatly into this option.
- Do we have a designer who can deliver the pixel art / SVG assets in-house?
- Does Framer Motion (already in repo? — verify) cover the animation needs?

## Comparison table

| Option | Graphics tech | Integration surface | Asset pipeline | Bundle-size impact | Kea/PostHog data binding |
|---|---|---|---|---|---|
| 1. Extend hedgehog-mode | Pixi.js 2D + matter-js (existing) | Existing global overlay at `GlobalModals.tsx:81`; Kea logic in place | Existing `/static/hedgehog-mode` path; sprite atlases | Negligible (deps already shipping) | Indirect — through the hedgehog-mode public API, may need upstream PRs |
| 2. Pixi.js scenes directly | Pixi.js 8 (WebGL/WebGPU) 2D | New overlay component, mirror `HedgehogMode.tsx` pattern | New static-assets route; sprite atlases | Small marginal (Pixi already in tree via hedgehog-mode) | Direct — own Kea logic reads/writes scene state |
| 3. Three.js / r3f | three.js WebGL2 (+ WebGPU experimental) 3D | New `<Canvas>` overlay; r3f tree binds to Kea via `useValues` | New: glTF models, textures, animations | Large (three + r3f + drei, code-split) | Direct and declarative — best React-idiomatic binding |
| 4. Babylon.js | Babylon WebGL2/WebGPU 3D, built-in physics + GUI | New canvas overlay; manual React↔Babylon bridge | New: glTF + textures; Babylon node materials | Large (~1 MB+ core, code-split) | Direct — imperative bridge from Kea selectors to Babylon scene |
| 5. PlayCanvas Engine | PlayCanvas WebGL/WebGPU 3D, ECS | New canvas overlay; manual React↔engine bridge | New: glTF + textures | Medium-large; smaller than Babylon | Direct — ECS components subscribe to Kea |
| 6. Godot HTML5 (WASM) | Godot 4.x rendering, WebGL2 / WebGPU | iframe or canvas mount; postMessage / `JavaScriptBridge` | Godot project + editor; export pipeline in CI | Very large (multi-MB WASM, gzip helps), lazy-load only | Indirect — async message bus, no direct Kea reads |
| 7. Bevy / Rust → WASM | wgpu (WebGPU with WebGL2 fallback), ECS | Canvas mount; `wasm-bindgen` boundary | Rust toolchain + glTF/spritesheets | Medium-large; depends on imports | Indirect — message bus or wasm-bindgen calls, no direct Kea reads |
| 8. CSS/SVG/HTML | DOM + CSS animations + SVG (no canvas) | Plain React components inside the existing app shell | PNG/SVG sprites; CSS keyframes | Negligible (images only) | Direct and trivial — components are Kea consumers like any other |

## Things to confirm before scoping any option

- Whether "Godot UI" was meant literally (Option 6) or as shorthand for "any game-aesthetic UI."
- Whether this is an overlay (rides on top of the regular PostHog UI, like hedgehog-mode does today) or a *replacement* shell (the entire app dressed up as a game).
- How the feature is gated — feature flag, user setting (cf. `frontend/src/scenes/settings/user/HedgehogModeSettings.tsx`), or always-on.
- Whether this is OSS-shippable — the repo is public; any 3D asset pack needs a license that allows redistribution.
- Whether the existing hedgehog-mode overlay should keep working alongside this, or be folded into it.

---

## Synthesis — verdicts after research, then revised for Hedgemony's actual context

**Current product contract:** renderer choice is intentionally undecided. The implementation specs should stay engine-agnostic: tRPC + Zustand + nest/hoglet/chat state feed whatever map renderer wins later. This document is research input, not a locked decision.

### Verdicts as researched (SaaS-web framing)

| # | Option | Verdict | Confidence |
|---|---|---|---|
| 1 | Extend hedgehog-mode | Cull. Public API is hedgehog-shaped; only `spawnActor(Actor)` is generic and even that is gated by a single bundled spritesheet. Real path is a fork of `PostHog/hedgehog-mode` to add a scene/plugin layer. | high |
| 2 | Pixi.js direct | Keep. Pixi 8 is already transitively in tree via hedgehog-mode. Copy lazy-load + state-bridge pattern from `HedgehogMode.tsx`. Watch for duplicate Pixi if not deduped. | high |
| 3 | three.js / r3f | Conditional keep. Runtime fine (~240–280 KB gz code-split, `frameloop="demand"` solves idle). **Real blocker is asset licensing** — no CC0 pack matches WC3/AgentCraft aesthetic. AgentCraft ships ~150 MB of FBX with unclear licensing. Quaternius RTS Pack is the closest CC0 option, visibly downgrade. | high |
| 4 | Babylon.js | Cull. "three.js but different, with worse React ecosystem." `react-babylonjs` is single-maintainer, lagging. Pick r3f instead. | high |
| 5 | PlayCanvas | Cull. `@playcanvas/react` is officially maintained but ~1/1500 the weekly downloads of r3f. ECS does not pay off at dozens of units. | high |
| 6 | Godot HTML5 (WASM) | Keep as the "literal" path. Single-threaded export (default in 4.3+) sidesteps COOP/COEP. ~5 MB Brotli engine + pck. `JavaScriptBridge` stable across 4.x. OSS-review friction real in a public analytics app. | moderate |
| 7 | Bevy / Rust WASM | Cull. Pre-1.0 with quarterly breaking releases; realistic build size 44 MB; WebGL2/WebGPU split forces a single-renderer pick. | high |
| 8 | CSS/SVG | Cull as standalone. Keep as HUD layer. Visual ceiling is "styled web app with hedgehog stickers." | high |

### Why several verdicts shift for Hedgemony specifically

The original framing assumed:
- A **CDN-served web bundle** where every megabyte costs every user — drove down Godot (5 MB WASM) and r3f (~280 KB gz + 3D assets).
- An **OSS-public** codebase where any shipped asset needs a redistributable license — drove down anything that needs WC3-quality 3D art.
- A **Kea + React 18** host where r3f's declarative JSX-to-scene-graph mapping was the killer feature — drove down Babylon/PlayCanvas.
- An **overlay** on top of an existing analytics product — drove down Godot/Bevy (engine ↔ host bridge feels disproportionate vs the rest of the app).

The actual Hedgemony framing inverts most of these:
- **Electron app distributed as an installer.** A 30–50 MB Godot WASM bundle ships *inside the installer*, downloaded once. No CDN cost-per-user, no lazy-load pressure, no COOP/COEP coordination — Electron's `BrowserWindow` is permissive.
- **Hedgemony is the game**, not game-y dressing on a dashboard. The visual quality ceiling is the *product*, not a flourish. That elevates anything with a real editor/scene system (Godot) and depresses "just enough canvas to draw sprites" (Pixi).
- **Zustand + tRPC, not Kea + REST.** r3f's "declarative scene tree binds to selectors" advantage shrinks — Zustand selectors work fine from any imperative engine. Babylon/PlayCanvas's React ecosystem disadvantage shrinks. Godot's *non*-declarative `JavaScriptBridge` bridge is closer to parity with the alternatives.
- **No OSS-shippability constraint on bundled assets.** posthog-code is open source but desktop-distributed; FBX/glTF packs that ship inside the installer aren't held to the same redistribution bar as inlined web assets. The Quaternius RTS Pack (or even a commissioned pack) becomes a normal decision, not a structural blocker.

### Revised verdicts under the Hedgemony context

- **Option 6 (Godot HTML5) moves from "viable but hard sell" to "leading candidate"** if you're already comfortable building the actual game in the Godot editor. The editor's scene system, animation graph, navmesh/pathfinding, tile maps, and signals architecture are the right tools for an AoE-style game. Doing the same work in r3f or Pixi means building those affordances from scratch.
- **Option 2 (Pixi direct) stays viable** as a "ship-fast prototype" path — especially if Hedgemony's first iteration is more dashboard-with-icons than full RTS. Pixi-on-Electron is solid; the AgentCraft-style nests-on-a-map view doesn't strictly need 3D.
- **Option 3 (r3f) demotes slightly.** The asset-licensing blocker softens (assets ship in the installer), but the "build the game UI in React JSX" approach is genuinely awkward for an actual RTS with persistent world state, pathfinding, fog of war, unit selection. r3f shines for "3D React scene"; Hedgemony is "RTS that React happens to host."
- **Options 4, 5, 7, 8 unchanged** — Babylon/PlayCanvas/Bevy/CSS-only verdicts hold in either context.

### Recommendation (revised)

This is a decision framework, not the current product contract.

If the answer to "are you actually going to build a full RTS, or just a top-down map view with icons?" is:

- **Full RTS** (fog of war, unit selection, pathfinding, save/load of world state, RTS-quality animation): **Option 6, Godot HTML5 embedded in Electron.** Build the game in the Godot editor, ship the export inside the installer, bridge to tRPC/Zustand via `JavaScriptBridge` for nest/hoglet state. Confidence: *moderate*. Hard parts: the bridge protocol, Godot project layout in the monorepo, and getting Godot devtools onboarded.
- **Top-down map view with icons and tween animations** (the dashboard-as-RTS reading): **Option 2, Pixi.js direct, plus Option 8 for HUD/chrome.** Cheap, ships in days, no new language/toolchain. The visual ceiling is "well-styled 2D game" — fine for "nests on a map, hoglets walking between them." Confidence: *high*.
- **Hybrid you want now**: ship an engine-neutral React map shell for the earliest slices, then pick Option 2 or Option 6 once the interaction model proves what the renderer needs. The `Hibernacula`/`Nest`/`Hoglet` data model in `spec.md` is engine-agnostic — Zustand selectors + tRPC subscriptions feed either path.

**Researcher's bias, not a decision:** if Hedgemony becomes a true RTS, Option 6 (Godot) still looks strongest. If it stays a command map with RTS affordances, Pixi or a lightweight React shell may be plenty.
