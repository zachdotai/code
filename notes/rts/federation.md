# Hedgemony — Nest Federation

**Pitch:** the per-nest hedgehog is a city manager. Nobody is the regional governor. As soon as there's more than one active nest, the operator becomes the regional governor by default — eyeballing two chat panels, manually copying signals from one nest to another, spotting that goal A and goal B have started overlapping. Federation gives the Builder that job. She watches the swarm across nests, surfaces overlaps and handoffs, proposes merges/splits when the goal landscape drifts. She does **not** override per-nest hedgehogs. Companion docs: [spec.md](./spec.md), [multiplayer.md](./multiplayer.md).

This is the v1-shaped concrete plan behind the v2 line in `spec.md`: *"Cross-nest hedgehog coordination on overlapping signals."*

---

## Why the Builder

She's the only persistent across-nests unit on the map already. Today her single job is creating nests — selecting her docks a command panel, build mode places a nest. Two implications:

1. **She already sees the whole map by virtue of being on it.** No new unit, no new sprite category, no new docked panel surface.
2. **Her current job is structurally a "meta nest" operation** — deciding *where* the next nest sits in goal space. Watching for overlap and proposing merges is the same operation in reverse.

If she does not get this role, the natural alternative is a separate "Council" or "Caretaker" unit, which costs a sprite, a name, voice lines, and a place on the map for what is conceptually one job. Not worth it for v1.

Naming wobble: as her scope grows, "Builder" understates what she does. Worth a rename pass eventually (Architect, Sett-master, Caretaker), but defer until the role is real — see open questions.

---

## Vocabulary

| Game term | What it is | PostHog Code primitive |
| --- | --- | --- |
| **Builder (federated)** | The existing Builder unit, extended with **watch / bridge / propose** capabilities across all active nests. Still the only entry point for nest creation. | Existing client-side unit + new sqlite row for her persistent state. |
| **Overlap signal** | A persistent observation that two nests' goals, signals, or PR graphs touch. Distinct from a SignalReport — internal-only, never lands in the Inbox. | New row in `hedgemony_overlap`. |
| **Proposal** | An operator-facing suggestion: "merge nest A into B", "split this prickle into a new nest", "forward signal X from A's queue to B", "share scratchpad section Y between A and B". | New row in `hedgemony_builder_proposal`. |
| **Bridge** | A durable cross-nest context link between two nests: signal forwards, scratchpad references, shared docs. Lighter than a merge. | New row in `hedgemony_nest_bridge`. |
| **Merge** | Destructive: nest B's goal, audit log, roster, PR graph fold into nest A. B is closed with a tombstone pointing at A. Operator-confirmed only. | Saga over existing tables, no new schema beyond a tombstone column on `hedgemony_nest`. |

---

## The Builder's three jobs

### 1. Watch

Passive observation across all `status = 'active'` nests. Re-evaluated on a `BuilderTickService` cadence (slower than `HedgehogTickService` — federation is not real-time).

Inputs she considers:

- **Goal-space overlap.** Embedding similarity between each pair of nests' goal specs + grouped signals (the same `embedText` / `document_embeddings` pipeline the signal router already uses). If similarity rises above a threshold, write a `hedgemony_overlap` row.
- **Incoming-signal collision.** A new SignalReport that scores above the affinity threshold for **more than one** nest. Today the router picks the highest match and routes there; the Builder records the runner-up overlap.
- **PR graph crossing.** A PR in nest A's graph depends on or conflicts with a PR in nest B's graph (`hedgemony_pr_dependency` rows that cross `nest_id`).
- **Hedgehog cross-references.** A per-nest hedgehog mentioning another nest's name or topic in chat or audit log — cheap regex pass after each tick.
- **Scratchpad drift.** Two nests' scratchpads converging on the same files, the same skills, the same MCP servers — fuzzy match over the structured parts of `hedgemony_hedgehog_state`.

Output is one or more `hedgemony_overlap` rows with a kind, score, evidence pointers, and `last_seen_at`. Overlaps decay if they stop being observed.

### 2. Bridge

When overlap is real but the nests are still distinct goals, the right move is a **bridge**, not a merge. Examples:

- **Signal forwarding.** Nest A keeps owning the signal, but nest B's hedgehog gets the report as inbound context on her next tick. Cheap, reversible.
- **Scratchpad reference.** Nest A's scratchpad gains a `[[see nest B: <section>]]` reference. Hedgehog ticks can chase the pointer.
- **PR graph linking.** A PR dependency edge crosses nests. Each hedgehog sees the cross-nest edge in her graph view and routes review/CI feedback appropriately.

Bridges are stored as `hedgemony_nest_bridge` rows with `(nest_a, nest_b, kind, payload, created_by)`. Created either by the Builder (proposal accepted) or directly by the operator.

The point of bridges: 80% of "share context" use cases don't need a merge. Merge is heavy and irreversible-feeling; bridge is a one-line row.

### 3. Propose

The Builder writes proposals into `hedgemony_builder_proposal`. They surface in her command panel as a "Notices" tab with an unread badge on her sprite. Proposal kinds:

| Kind | Trigger | Action on accept |
| --- | --- | --- |
| `merge` | Goal-space similarity sustained above threshold for N ticks AND PR graphs cross. | Saga: target nest absorbs source's goal text into a combined spec, source's hoglets re-bind, source's audit log appends with a merge marker, source nest set to `status = 'merged_into:<id>'`. |
| `split` | Single nest's goal embedding spreads above an internal-cohesion threshold (the hedgehog is pursuing two things). | Suggest splitting the prickle the operator most recently selected, or the cluster the Builder identifies. Operator places the new nest. |
| `bridge` | Overlap detected but cohesion within each nest still strong. | Insert `hedgemony_nest_bridge` row of the appropriate kind. |
| `forward` | A new SignalReport scored above threshold for multiple nests. | Forward to runner-up nests as inbound context. Bridge-shaped under the hood. |
| `adopt` | A wild or unnested-signal hoglet matches an existing nest's goal-space above threshold. | Same as today's manual operator adopt, but pre-proposed. |

**Autonomy boundary.** The Builder never executes `merge` or `split` autonomously. `bridge`, `forward`, and `adopt` proposals **may** auto-execute above a high-confidence threshold (configurable, off by default in v1). Per-nest hedgehogs never see a destructive Builder action they didn't get to react to.

---

## How this slots into the existing tick loop

The Builder gets her own service, parallel to `HedgehogTickService`:

```
HedgehogTickService     — per nest, frequent, judges goal + manages brood.
BuilderTickService      — across all active nests, slower, judges overlaps + writes proposals.
```

She reads the same hibernacula every per-nest hedgehog reads (it's all one sqlite db). She writes only her own tables (`hedgemony_overlap`, `hedgemony_builder_proposal`, `hedgemony_nest_bridge`). When a proposal is accepted, a saga (`packages/shared` Saga pattern) executes the structural change atomically across the affected tables.

Concretely: a `merge` saga is the most invasive. Step-by-step rollback already exists in the saga lib; merge is the canonical use case for it.

---

## Surfaces

- **Builder sprite badge.** Small unread count over her sprite when proposals exist. Same visual language as nest chat unread.
- **Builder command panel — Notices tab.** Lists proposals with evidence pointers. Each row: accept / dismiss / snooze. Existing panel already has tabs for `Build nest` / `Quick nest`; add `Notices`.
- **Overlap visualization on the map.** Faint arc between two nests when an active overlap row exists, colored by kind. Off by default; toggle in the Builder panel. Cheap to draw with the existing SVG overlay.
- **Per-nest hedgehog awareness.** When the operator opens a nest's command panel, a thin "Federation" subsection lists outbound bridges and active overlaps with sibling nests. Not noisy — collapsed by default.
- **Audit log entries.** Every Builder action (proposal accepted, bridge created, merge executed) gets an entry in the affected nests' audit logs, tagged with `actor: 'builder'`. Mirrors how per-nest hedgehog audit entries work today.

---

## State and schema

New tables. All UUID PK, `created_at`, `updated_at`, soft-delete (matches the rest of hedgemony).

```sql
-- The Builder's own persistent state (today she has none).
CREATE TABLE hedgemony_builder_state (
  id TEXT PRIMARY KEY,                -- always one row for v1 (singleton)
  last_tick_at INTEGER,
  config_json TEXT,                   -- thresholds, auto-execute flags
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Persistent overlap observations. Decay-eligible.
CREATE TABLE hedgemony_overlap (
  id TEXT PRIMARY KEY,
  nest_a_id TEXT NOT NULL,
  nest_b_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- 'goal_embedding' | 'pr_graph' | 'signal_runnerup' | 'scratchpad' | 'chat_xref'
  score REAL NOT NULL,
  evidence_json TEXT NOT NULL,        -- pointer payload (PR ids, signal ids, embedding distance, etc.)
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  resolved_at INTEGER,                -- set when overlap drops below threshold or proposal accepted/dismissed
  FOREIGN KEY (nest_a_id) REFERENCES hedgemony_nest(id) ON DELETE CASCADE,
  FOREIGN KEY (nest_b_id) REFERENCES hedgemony_nest(id) ON DELETE CASCADE
);
CREATE INDEX hedgemony_overlap_pair_idx ON hedgemony_overlap (nest_a_id, nest_b_id);
CREATE INDEX hedgemony_overlap_open_idx ON hedgemony_overlap (resolved_at);

-- Operator-facing suggestions.
CREATE TABLE hedgemony_builder_proposal (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- 'merge' | 'split' | 'bridge' | 'forward' | 'adopt'
  primary_nest_id TEXT,
  secondary_nest_id TEXT,
  hoglet_id TEXT,                     -- for adopt
  signal_report_id TEXT,              -- for forward
  evidence_json TEXT NOT NULL,
  status TEXT NOT NULL,               -- 'open' | 'accepted' | 'dismissed' | 'snoozed' | 'auto_executed'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX hedgemony_builder_proposal_open_idx ON hedgemony_builder_proposal (status, created_at);

-- Durable cross-nest context links.
CREATE TABLE hedgemony_nest_bridge (
  id TEXT PRIMARY KEY,
  nest_a_id TEXT NOT NULL,
  nest_b_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- 'signal_forward' | 'scratchpad_ref' | 'pr_dep' | 'shared_doc'
  payload_json TEXT NOT NULL,
  created_by TEXT NOT NULL,           -- 'builder' | 'operator'
  created_at INTEGER NOT NULL,
  removed_at INTEGER,
  FOREIGN KEY (nest_a_id) REFERENCES hedgemony_nest(id) ON DELETE CASCADE,
  FOREIGN KEY (nest_b_id) REFERENCES hedgemony_nest(id) ON DELETE CASCADE
);
CREATE INDEX hedgemony_nest_bridge_pair_idx ON hedgemony_nest_bridge (nest_a_id, nest_b_id);
```

One existing table needs a column:

```sql
ALTER TABLE hedgemony_nest ADD COLUMN merged_into_id TEXT;  -- null unless this nest was merged
```

---

## Concrete changes

### Main process

- `apps/code/src/main/services/hedgemony/BuilderTickService.ts` — periodic across-nests tick. Parallel to `HedgehogTickService`. Reads all `status='active'` nests, computes overlap signals, writes proposals.
- `apps/code/src/main/services/hedgemony/FederationService.ts` — saga-backed handlers for `acceptProposal`, `createBridge`, `mergeNests`, `splitNest`. Uses `@posthog/shared` Saga for the merge path so partial-failure rollback is automatic.
- `apps/code/src/main/trpc/routers/hedgemonyFederation.ts` — new router. Procedures: `proposals.list`, `proposals.accept`, `proposals.dismiss`, `proposals.snooze`, `bridges.list`, `bridges.create`, `bridges.remove`, `overlaps.list`, `nests.merge`, `nests.split`, `builderState.get`, `builderState.update`. Subscriptions: `proposals.watch`, `overlaps.watch`.
- Migrations `0016_hedgemony_federation.sql` (new tables) and `0017_hedgemony_nest_merged_into.sql` (column).

### Renderer

- `features/hedgemony/state/federationStore.ts` — Zustand store for proposal list, overlap list, unread counts. Pure UI cache subscribed to tRPC.
- `features/hedgemony/components/BuilderCommandPanel.tsx` — add `Notices` tab listing open proposals. Existing tabs for `Build nest` / `Quick nest` unchanged.
- `features/hedgemony/components/BuilderSprite.tsx` — add unread badge driven by `federationStore.unreadCount`.
- `features/hedgemony/components/OverlapArcs.tsx` — SVG overlay layered above `HedgemonyMapSurface`. Toggleable from Builder panel.
- `features/hedgemony/components/NestCommandPanel.tsx` (or wherever per-nest is rendered) — new collapsed `Federation` subsection showing outbound bridges + active overlaps.
- `features/hedgemony/hooks/useFederation.ts` — wraps the tRPC procedures with the same shape as the existing nest hooks.

### Adapters (matches the new repo/remote split in recent commits)

- `features/hedgemony/domain/ProposalRepository.ts`, `OverlapRepository.ts`, `BridgeRepository.ts` interfaces.
- `features/hedgemony/adapters/...Repository.ts` tRPC-backed implementations following the pattern in `NestRepository.ts`.

### Config

Builder thresholds live in `features/hedgemony/config.ts` so they tune in one place:

```ts
federation: {
  builderTickMs: 60_000,              // far slower than hedgehog tick
  overlapEmbeddingThreshold: 0.78,    // similarity above which an overlap row is written
  mergeProposeAfterTicks: 5,          // sustained overlap before a merge proposal is written
  autoExecuteThreshold: 0.95,         // bridge/forward/adopt only — never merge/split
  autoExecuteEnabled: false,          // off by default in v1
  overlapDecayMs: 24 * 60 * 60 * 1000,
}
```

---

## v1 vs v2

**v1 (local Builder, local nests).** Everything above. The Builder ticks on the operator's machine; she's asleep when posthog-code is closed (same caveat as the per-nest hedgehog). She watches the same sqlite db every nest writes to. Merge sagas run locally.

**v2 (cloud Builder).** When the cloud-side hedgehog lands (per [spec.md](./spec.md) v2 plan), the Builder follows the same path. The federation table set ships unchanged — schema was UUID-first and cloud-shaped from the start. The big v2 unlock: she ticks while your laptop is closed, so a merge proposal worth acting on at 3am surfaces in the morning instead of waiting for you to come back.

**v2 (multi-operator with [multiplayer.md](./multiplayer.md)).** In slice 2+ of multiplayer, proposals become a shared surface. Accept/dismiss writes get stamped with `operator_id` (already covered by multiplayer's plan). Open question whether a destructive proposal (merge/split) should require explicit second-operator confirmation when multiple operators are connected — flagged below.

---

## Out of scope (v1)

- **Autonomous merges or splits.** Always operator-confirmed.
- **Cross-org federation.** All nests in a federation share one PostHog org; no cross-org context bridges.
- **Bridge between merged + dormant nests.** Once a nest is `merged_into:<id>` or `dormant`, federation ignores it. The merge target inherits the relevant overlaps.
- **Builder voice lines.** She gets the same audit-only treatment as hedgehogs for now; voice can come with the rename pass.
- **Operator-defined custom overlap kinds.** The five kinds in the schema are the v1 set. Plugin-able later.

---

## Open questions

1. **Naming.** Once she does this much, "Builder" undersells the role. Worth a rename pass — Architect / Sett-master / Caretaker — but renaming touches sprite, voice, copy, and player muscle memory. Defer until federation has shipped and the role is felt? *(Confidence: moderate — leaning defer.)*
2. **Threshold defaults.** Embedding similarity at 0.78 and 5 sustained ticks before a merge proposal is a guess. Need a small offline pass over a corpus of plausible-but-distinct goal pairs to calibrate. *(Confidence: low.)*
3. **Builder vs per-nest hedgehog conflict.** If a hedgehog is mid-merge-saga and the operator opens her command panel and changes the goal of the source nest, what happens? Proposal: saga either completes or rolls back atomically — operator's goal edit fails with a clear message if the source nest's row is locked. Punt the locking detail to implementation. *(Confidence: moderate.)*
4. **Auto-executed `forward` blast radius.** Forwarding a signal from nest A to nest B costs B's hedgehog one tick of context. Cheap in isolation, but if the Builder mis-routes, every hedgehog tick burns API budget. Cap auto-forwards per nest per hour? *(Confidence: low.)*
5. **Split proposal placement.** A `split` proposal needs to suggest *where* to place the new nest. Auto-pick a free spot near the source, or always require operator placement via build mode? Lean toward operator placement — keeps the build-mode interaction surface coherent. *(Confidence: high.)*
6. **Multiplayer + destructive proposals.** When two operators are connected, should a merge require both to confirm, only the host, or only the proposer? Lean: only one operator (the proposer), but every other connected operator gets a live toast so they can challenge before the saga completes. *(Confidence: moderate.)*
7. **Tombstone visibility on the map.** A merged nest's tombstone could show as a faded sprite (so the operator remembers it existed and where its work went), or be hidden entirely. Lean faded — supports "where did X go?" questions without growing the map. *(Confidence: moderate.)*
