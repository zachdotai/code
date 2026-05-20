# Hedgemony — Multiplayer

How shared / collaborative play could work on Hedgemony, using `~/dev/nexus-games` RTS as the reference architecture and the existing Hedgemony stack as the constraint. Companion docs: [spec.md](./spec.md), [backend-frontend.md](./backend-frontend.md), [backend-integration.md](./backend-integration.md).

---

## Reference: how nexus-games RTS does it

Nexus's Deep Space Ops is the closest comparable: 2D RTS, vanilla JS, peer-to-peer, no server. The shipping architecture is **lockstep deterministic simulation** (the `host-authoritative` framing in `docs/multiplayer-redesign.md` is the older design; the live code in `js/rts/lockstep.js` is lockstep). Pieces worth borrowing:

| Piece                                                                  | What it does                                                                                                                                                       | Hedgemony fit                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **PeerJS WebRTC** (`multiplayer.js`)                                   | Pure browser-to-browser transport; no signalling server beyond PeerJS's free broker. Short 4-char room codes from an unambiguous alphabet.                          | Reusable. Electron renderer can host PeerJS the same way; or we mediate via PostHog cloud (see v2).      |
| **Version hash** (`MP_VERSION`)                                        | Bumped on every balance change; both clients must match or start is blocked.                                                                                       | Directly applicable. We need this from day one — schema drift between clients is the same desync risk.   |
| **Lockstep turn loop** (`lockstep.js`)                                 | `TURN_LENGTH=6` ticks per turn, `INPUT_DELAY=2` turns. Commands buffered, exchanged per-turn, executed in deterministic order on both clients.                     | **Doesn't fit.** Hedgemony has no deterministic tick. See [Why lockstep doesn't fit](#why-lockstep-doesnt-fit). |
| **Seeded PRNG** (`rng.js` Mulberry32)                                  | All simulation randomness goes through `rtsRand()`. Rendering may use `Math.random()`.                                                                             | Doesn't apply for the same reason — there is no shared simulation to seed.                               |
| **Checksum desync detection** (`lsChecksum`)                           | Every 60 turns, hash entity positions/HP/gold, send to peer, compare against stored value for that turn.                                                           | Reusable shape, different content: hash the relevant hibernacula slice per epoch.                        |
| **Command pattern w/ `side` stamp** (`commands.js`)                    | Every player action is a JSON command stamped with `cmd.side`; one unified executor consumes the queue.                                                            | We already have this shape — `nests.create`, `hoglets.adopt`, `nestChat.send`, etc. all flow through tRPC mutations. Stamp them with `operator_id` instead of `side`. |
| **Faction handshake** (`mpPickFaction` → `mpCheckStart`)               | Each peer picks a faction, sends it, host emits `t:'go'` once both sides chosen.                                                                                   | Replace "faction" with **operator identity** (PostHog user). Same handshake shape, different semantics.  |
| **Keep-alive + disconnect handling**                                   | Pings keep the WebRTC connection warm; close triggers a clear "opponent disconnected" toast.                                                                       | Directly reusable; toast lives in our existing `ToastSink`.                                              |

---

## Why lockstep doesn't fit Hedgemony

Nexus runs an authoritative 60 fps simulation: gold ticks, projectile physics, AI decisions, all from a seeded RNG. Two clients fed identical commands produce identical worlds. That's the precondition for lockstep, and it's the precondition Hedgemony lacks:

- **No deterministic tick.** Hedgemony's "tick" is `HedgehogTickService` — an LLM call that judges goal state, decides whether to raise a hoglet, and writes audit entries. Non-deterministic by definition.
- **Long-running, asynchronous outcomes.** Cloud Tasks finish minutes/hours later, PR review comments arrive whenever GitHub feels like it, CI fails on its own schedule. These are not "commands replayable on both clients" — they're external events arriving once, ingested once.
- **Authoritative state lives in storage, not in RAM.** The simulation isn't `S.entities[]` in memory rebuilt every frame; it's rows in sqlite (`hedgemony_nest`, `hedgemony_hoglet`, …) plus server-owned Tasks. State is reconciled on read, not on tick.
- **No "side."** Two operators on the same Hedgemony view aren't on opposing teams managing separate gold pools. They're co-managing the same swarm. Stamping `cmd.side = 'enemy'` is meaningless; commands need `operator_id` for audit, but they all mutate the same shared world.

The correct model is therefore **shared-state co-op**, more like Figma / Miro / a Google Doc than an RTS lockstep. Below.

---

## Proposed model: shared-state co-op + presence overlay

Two layers, addressable independently:

1. **Authoritative state (durable).** The hibernacula rows + cloud Tasks. Mutations route through the existing tRPC mutations (`nests.create`, `hoglets.adopt`, `nestChat.send`, …). Every co-op operator's writes hit the same rows. Conflict resolution falls out of the existing constraints (e.g. `hedgemony_hoglet (signal_report_id)` UNIQUE handles ingestion races today).
2. **Presence (ephemeral).** Cursors, selection rings (prickles), Builder positions, build-mode ghosts, in-flight pan/zoom. None of this needs persistence — it's pure overlay, broadcast at ~10 Hz, dropped on disconnect.

The two layers are deliberately decoupled. Presence is cheap and can ship first; shared mutations are heavier and need a host model.

### Conflict resolution rules

| Operation                          | Rule                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Drag a nest to a new `map_x,map_y` | Last-write-wins (write timestamp on the mutation). Optimistic locally, snap on conflict.                               |
| Two operators spawn from same nest | Both succeed; both hoglets appear. Existing `nests.create` / `hoglets.spawnAdhoc` already serialize at the saga.       |
| Two operators send nest chat       | Both messages persist (ordered by `created_at`); next hedgehog tick sees both.                                         |
| Operator A "adopts" a wild hoglet that Operator B is dragging | The adopting write wins; B's local drag aborts on the next state diff.                                                 |
| Builder position                   | **Per-operator, not shared.** Each operator has their own Builder unit (client-side, no sqlite row already — trivial). |
| Prickle selection                  | **Per-operator.** Selection is already pure client state (`selectionStore`); broadcast as presence only for overlay.   |

This is the whole "no side" insight in one table: shared state is shared, ephemeral state is per-operator, and the existing data model already discriminates them correctly.

---

## Slices (each ships independently)

### Slice 1 — Presence overlay only

Lowest-risk, highest-perceived-value first. No mutation sharing yet; each operator's swarm is still local to them.

- Lift WebRTC pairing (PeerJS, 4-char codes, version hash) from `nexus-games/js/rts/multiplayer.js` into `apps/code/src/renderer/features/hedgemony/multiplayer/peerSession.ts`.
- New presence-only message types: `t: 'cursor'`, `t: 'selection'`, `t: 'builder'`, `t: 'build-ghost'`.
- New store `presenceStore` (renderer): keyed by `peerId`, holds remote cursor, selection ids, builder position, build-ghost state. Pure UI cache; pruned on disconnect.
- New overlay components: `<RemoteCursors />`, `<RemoteSelections />`, `<RemoteBuilders />`. Layered above `HedgemonyMapSurface`. Drawn with the same framer-motion smoothing as local units.
- HUD: a small "connected with @username" chip + disconnect button. No actual swarm sharing yet.

The result: two engineers can pair on the same view of the same swarm and gesture/select live, even though writes still affect each operator's own local state.

### Slice 2 — Shared world via peer host

Now mutations flow. One operator's machine is the **host**; the other(s) become **guests** whose writes are forwarded to the host's tRPC layer.

- Guest's mutation calls (`hedgemony.nests.create`, `hedgemony.hoglets.spawnAdhoc`, etc.) get intercepted in the renderer tRPC client when `_mpMultiplayer && !isHost`. Instead of going to local main, they're serialized to the WebRTC channel: `t: 'mutation', op: 'nests.create', input: {...}, requestId}`.
- Host receives, calls the local tRPC procedure with the guest's input, captures the result, sends `t: 'mutation-result', requestId, ok|err`.
- Host streams its tRPC **subscriptions** (`nests.watch`, `hoglets.watch`, `nestChat.watch`) over WebRTC verbatim: `t: 'sub', sub: 'nests.watch', event: {...}`. Guest applies into its local stores as if the sub fired locally.
- Guest reads (`nests.list`, `hoglets.list`, etc.) bypass local main entirely — request goes to host, host runs it, sends result.

This mirrors nexus's host-authoritative path conceptually, just at the data-layer instead of the simulation-tick layer. The renderer doesn't know it's a guest — only the tRPC client transport changes.

**Permissions caveat**: cloud-Task-creating mutations on the host run under the **host's** PostHog auth, not the guest's. Spell this out in the connect handshake so the guest knows whose org/team owns spawned hoglets. Show the host's identity on every audit entry the guest causes.

### Slice 3 — Cloud-native multiplayer (v2)

This is the right long-term home and it lines up cleanly with the existing v2 plan in `spec.md` (cloud-side hedgehog + cloud-synced nest state).

- Hibernacula lives server-side. Subscriptions fan out from the cloud, not from one operator's laptop.
- No host/guest asymmetry. Every operator is a peer of the cloud. Pairing is identity-based ("invite @teammate to this nest") rather than 4-char code.
- Presence overlay channel becomes a PostHog WS / SSE topic instead of WebRTC.
- Reconnect / offline-edit handling becomes a real thing rather than "if host closes the laptop, the session ends." Same model as PR comments arriving at 3am.

Nothing in slice 1 or 2 needs to be thrown away — the WebRTC pairing keeps working for ad-hoc pair sessions, and the presence overlay components/stores are transport-agnostic.

---

## Transport

| Option                  | When                                                                       | Tradeoffs                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PeerJS WebRTC**       | Slice 1 + 2 (pair-session, ad-hoc).                                        | Zero infra. Latency excellent (P2P). Requires both peers online simultaneously, host's laptop is the source of truth.                                  |
| **PostHog cloud relay** | Slice 3.                                                                   | Identity-aware, survives reconnects, works cross-machine, auditable. Requires server-side delivery surface.                                            |
| **Hybrid (presence on WebRTC, mutations on cloud)** | A possible intermediate when cloud hedgehog ships before cloud presence.   | Splits cursor/selection from durable writes — fine because they were already decoupled by design.                                                      |

Slice 1 should hardcode WebRTC. Slice 3 should hardcode cloud. The transport abstraction at the renderer layer is `connection.send(msg)` / `connection.subscribe(handler)` — keep it 30 lines, do not over-engineer a transport interface up front.

---

## Concrete changes

### Renderer

- `features/hedgemony/multiplayer/peerSession.ts` — PeerJS wrapper. Direct port of `mpHost` / `mpJoin` / `mpWire` from nexus.
- `features/hedgemony/multiplayer/mutationProxy.ts` — wraps the existing tRPC client; when `isGuest`, routes mutations + subscriptions through the connection instead of IPC.
- `features/hedgemony/stores/presenceStore.ts` — remote cursor/selection/builder cache, keyed by peer id.
- `features/hedgemony/stores/multiplayerStore.ts` — `mode: 'off' | 'hosting' | 'guesting'`, peer roster, connection status, host identity. Pure UI state.
- `features/hedgemony/components/RemoteCursors.tsx`, `RemoteSelections.tsx`, `RemoteBuilders.tsx` — overlays above `HedgemonyMapSurface`.
- `features/hedgemony/components/MultiplayerPanel.tsx` — host/join code UI, identity badge, disconnect.
- `features/hedgemony/hooks/usePresenceBroadcast.ts` — RAF-throttled cursor/selection emitter; replaces nothing, additive.

### Main process

Slice 1 + 2 require **no main-process changes** — multiplayer is purely renderer-side because mutations stay routed through the existing tRPC procedures. Slice 3 adds:

- `apps/code/src/main/services/hedgemony/CloudSyncService.ts` — pushes/pulls hibernacula deltas against PostHog cloud, exposes a TypedEventEmitter that mirrors the existing per-router subscriptions.

### Schema

Slice 1 + 2: **none.** Presence is ephemeral; existing tables already carry the writes.

Slice 3: an `operator_id` column on `hedgemony_nest_message`, `hedgemony_operator_decision`, and `hedgemony_feedback_event` (already nullable in spirit). Add per-row write timestamps if not already present (UUIDs + `updated_at` already covers most of this).

### Constants

- `MP_VERSION` lives in `apps/code/src/renderer/features/hedgemony/multiplayer/version.ts`. Bumped on any change to mutation payload shapes or hibernacula schema. Handshake blocks start on mismatch with a "both refresh" toast, same as nexus.
- Room-code alphabet: copy nexus's `'3479ACDEFGHJKMNPQRTUVWXY'` — unambiguous in voice and typing.

---

## Identity, auth, telemetry

- Identity is the existing PostHog user (`AuthService`). No new login surface. Handshake `t: 'hello'` exchanges `{ userId, displayName, avatarUrl, mpVersion }`.
- Slice 2 audit entries record **whose** operator caused each mutation. Required for nest chat ("user A asked the hedgehog to kill hoglet 42") and for accountability when two operators clash.
- Telemetry: add `hedgemony.multiplayer_session_started`, `hedgemony.multiplayer_session_ended`, `hedgemony.multiplayer_peer_joined`, `hedgemony.multiplayer_mutation_forwarded` under the existing `hedgemony.*` namespace.

---

## Out of scope

- **Competitive PvP.** Not a fit for Hedgemony's product semantics; operators co-manage one swarm, they don't fight over gold.
- **Spectator mode** beyond presence overlay. Read-only viewers are a slice-3 problem; force operators to be peers in slice 1 + 2.
- **Replay / time travel.** The audit log already gives a textual history per nest; map replay isn't worth the bytes.
- **Offline edits in slice 1 + 2.** If host loses connection, the session ends; existing v1 caveat ("local hedgehog is asleep when laptop is closed") covers it.

---

## Open questions

1. **Host election when the host disconnects.** Slice 2 has no answer. Probably: session ends, guest is told "host disconnected — your changes since X are lost." Punt to slice 3, where cloud is always-on.
2. **Per-operator Builder vs shared Builder.** Proposal above says per-operator. Worth a UX check — two simultaneous build-modes might collide visually on the same nest tile.
3. **Mutation forwarding latency.** Nexus's `INPUT_DELAY=2` turns is ~200ms; we'd expect similar P2P RTT, but our mutations are heavier (DB writes + cloud API). Validate end-to-end perceived latency early in slice 2.
4. **Permissions surface.** When a guest spawns a cloud hoglet through the host, it runs under host auth/org. Should this require explicit host approval per mutation, host approval at session start, or no approval at all? Recommend session-start approval for v1.
5. **What's "the same map"?** Slice 2 host shares their entire Hedgemony view. Should we eventually scope to a single nest ("invite teammate to this nest only") for least-privilege?
6. **Naming.** Nexus calls them "host/guest." Hedgemony's voice is hedgehog-themed — "sett-master" / "sett-mate"? Skip until slice 2 is real.
