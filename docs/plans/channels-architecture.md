# Channels architecture — scoping the bigger work

Status: scoping draft. Grounded in the code as of July 2026; behind the
`project-bluebird` flag unless noted.

## The target model

The framing we're building toward:

- **A channel is the agent.** It is a durable container for a stream of work,
  carrying persistent context (repos it works in, best practices, history) so
  work never needs to be re-briefed. Context updates when work completes or is
  abandoned, and (v2) when the channel is referenced from other channels.
- **A thread is a piece of work.** Each thread in a channel is a session, and
  each thread shape maps to an artifact:
  | Thread shape | Artifact |
  | --- | --- |
  | Do this task | PR |
  | Plan-mode task | plan.md |
  | Here's a signal / work done | PR |
  | Generate artifact | Canvas |
  | Loop / automation | Canvas, PR |
- **The thread creator steers.** Others can request to steer; the owner
  accepts or denies per user.
- **MCP can pull in all of the above** so channels are reachable from Slack,
  Claude, and other agent surfaces.

## What already exists

More of this is built than the framing implies. Inventory, with owners:

**Channels.** A channel is a top-level `type=folder` row in the cloud
`desktop_file_system` (Django API, project-scoped). Sidebar list via
`getDesktopFileSystemChannels` (`packages/api-client/src/posthog-client.ts`),
shared row client in `packages/core/src/canvas/desktopFsClient.ts`, name
validation in `packages/core/src/canvas/channelName.ts` (name is the
server-side path segment). Deep links `posthog-code://channel/{id}[/tasks/{id}]`
resolve via `packages/core/src/links/channel-link.ts`; ids are rename-proof.
Separately, the tasks product has a backend `TaskChannel`
(`packages/shared/src/domain-types.ts:74`) owning the task feed, with
`channel_type: "public" | "personal"` (the private `#me` channel),
`TaskThreadMessage`, and `TaskMention`.

**Threads.** A thread is a channel-filed `Task`
(`packages/core/src/canvas/channelTasksService.ts`); each run of a task is a
session (`packages/core/src/sessions/sessionService.ts`), local over ACP or
cloud over SSE (`packages/core/src/cloud-task/cloud-task.ts`), with handoff in
both directions. Thread messages from non-authors do not reach the agent
unless the author forwards them (`TaskThreadMessage.forwarded_*`) — a
proto-version of owner-gated steering.

**Channel context.** Per-channel `CONTEXT.md` lives as versioned folder
instructions (`getDesktopFolderInstructions`, `/context_generation/`
endpoints). Task creation folds it into the initial prompt as an optional
`<channel_context>` block (`packages/core/src/editor/prompt-builder.ts`,
`taskCreationSaga.ts`), with a dismissible chip in `TaskInput.tsx`. Channel
mode gives the agent a scratch directory and a repo-attach decision procedure
driven by CONTEXT.md (`packages/workspace-server/src/services/agent/agent.ts:635`).

**Artifacts.** The artifact union today is `canvas | pr`
(`packages/ui/src/features/canvas/components/WebsiteChannelArtifacts.tsx`).
Canvases are `dashboard` rows nested under the channel folder, freeform React
in a sandboxed iframe, code + versions in the row's `meta` blob
(last-write-wins, no optimistic concurrency —
`packages/ui/src/features/canvas/AGENTS.md`). PRs surface from
`latest_run.output.pr_url`. Plans exist in sessions
(`packages/core/src/sessions/latestPlan.test.ts`) but are not filed as channel
artifacts.

**Adjacent systems that overlap the vision but live elsewhere:**

- **Scouts** (`packages/core/src/scouts/`) are recurring server-dispatched
  agent runs — the "loop/automation" thread shape — but their findings land in
  the Signals **Inbox** (`packages/core/src/inbox/`), not in channels.
- **Home / workflows** (`packages/core/src/home/`, `workflow/`) aggregate
  PR-shaped work into situations server-side.
- **Autoresearch** (`packages/core/src/autoresearch/`) is a local
  metric-optimization loop over one task's session.

## The gaps

Measured against the target model:

1. **Context is static.** CONTEXT.md is generated on demand and hand-edited;
   nothing updates it when a thread completes, abandons, or ships a PR. The
   "channel is the agent" promise depends on this loop existing.
2. **Channels don't cross-pollinate.** No way to @ another channel and pull
   its context in; `TaskMention` is people-only.
3. **Two channel systems.** The desktop file-system folder (context +
   artifacts) and the backend `TaskChannel` (feed + threads) are distinct rows
   with distinct ids, stitched together client-side. Every future feature
   (membership, permissions, MCP) pays this tax twice.
4. **Artifact model is ad hoc.** `canvas | pr` is a UI union, not a domain
   concept. Plans, loops, reports, and files have no home; nothing guarantees
   a thread produces its artifact.
5. **Steering is binary and local-only.** Forward-a-message is
   author-mediated relay, not a grant. There is no request→accept/deny flow,
   and a teammate cannot even watch a local session — local transcripts are
   NDJSON on the owner's disk.
6. **No real-time multiplayer substrate.** The only push channel is per-run
   SSE for the owner. Channel feeds, presence, artifact edits, and mentions
   are all poll-based; canvas `meta` is documented last-write-wins.
7. **No MCP surface for channels.** External agents can't list channels, read
   CONTEXT.md, open threads, or file artifacts.
8. **Channel creation/organization is manual.** Agents don't create or
   suggest channels; there's no archive, discovery, or org-level convention
   support.

## Workstreams

Sized S/M/L/XL. Dependencies noted; A and B unblock most of the rest.

### A. Unify the channel model (L)

One channel identity that owns feed, context, artifacts, and membership.

- Decide the canonical row (likely the tasks-product `Channel`, with the
  desktop file-system folder becoming its storage facet, or vice versa) and
  migrate the other to reference it. Backend (Django) work plus a data
  migration; client work is mostly mechanical once ids unify.
- Introduce `packages/core/src/channels/` as a real feature (service, store,
  schemas) instead of channel logic living inside `canvas/`. Move
  `channelTasksService`, `channelName`, channel-link wiring there.
- Add membership (member list, join/leave, personal vs public vs private) to
  the canonical row — prerequisite for steering grants, mentions, and MCP
  auth.
- Exit criteria: one channel id in deep links, task rows, artifact parents,
  and the feed; `domain-types.ts` no longer needs the "distinct from the
  desktop file-system channel folders" disclaimer.

### B. Artifact registry (M)

Make "thread shape → artifact" a domain concept.

- A typed `Artifact` row (cloud, child of channel): `kind: canvas | pr |
  plan | report | file | loop`, `thread_id`, `ref` (PR URL, fs row id,
  plan version id), lifecycle status.
- Thread shapes declared at creation (`do | plan | signal | generate | loop`)
  so the session can be held to producing its artifact; plan-mode threads file
  the accepted plan.md as an artifact version instead of leaving it in the
  transcript.
- Replace the `WebsiteChannelArtifacts.tsx` union with a registry the UI and
  MCP both read.
- Depends on A for the parent id; canvas and PR kinds are backfills of what
  exists.

### C. Context lifecycle (L)

The channel learns. This is the highest-leverage differentiator.

- **On thread completion/abandonment:** a server-side post-run step (same
  Temporal machinery as home-snapshot evaluation) summarizes the thread —
  what shipped, what was decided, what failed — and proposes a CONTEXT.md
  edit as a new instructions version. The versioned-instructions endpoint
  already exists; the new work is the summarizer, the diff-style proposal,
  and an accept/auto-accept policy per channel.
- **Provenance:** each context section carries which thread produced it, so
  stale context can be traced and pruned.
- **Budgeting:** CONTEXT.md is injected into every prompt; the updater must
  compact, not append. Define a size budget and a compaction pass.
- **v2 — cross-channel references:** when channel X is @-mentioned from
  channel Y (see D), record the reference and let X's updater fold in what Y
  learned. Explicitly out of scope for v1.
- Independent of A/B in mechanism, but lands cleanest after A.

### D. Channel mentions and cross-pollination (M)

`@channel-name` in a thread pulls that channel's context in.

- Extend the mention model (`packages/shared/src/mentions.ts`,
  `mentionActivity.ts`) with a channel-mention kind.
- Resolution at prompt-build time: an @-mentioned channel contributes its
  CONTEXT.md as a second `<channel_context>` block (the prompt-builder
  already supports named blocks) — plus an MCP tool the running agent can
  call to read a channel's context lazily rather than front-loading it.
- Record the reference edge for C's v2.
- Depends on A (stable channel identity) and pairs with G (MCP).

### E. Steering grants and shared live sessions (XL)

The multiplayer core: creator-owned steering with accept/deny, and threads
teammates can actually watch.

- **Grant flow (M):** a `steering_request` on the run (requester, scope),
  surfaced to the owner as an approval (consistent with the existing
  permission-request pattern in sessions), producing a per-user grant the
  command endpoint enforces. Cloud runs already have the command surface
  (`user_message` via `/command/`); the backend gains an authorization check
  beyond "task author".
- **Shared visibility (L–XL):** teammates need to see the live transcript.
  Cloud runs: extend `stream_token` issuance to channel members (read-only) —
  mostly backend auth work, the SSE pipe exists. Local runs are the hard
  case: either relay local session events up to the cloud feed (making the
  local/cloud transcript residency symmetric), or scope v1 to "shared threads
  run in the cloud" and make that a product stance. Recommendation: take the
  product stance for v1; local-relay is a follow-on.
- Depends on A (membership). The grant flow can ship before shared
  visibility (owner forwards remain the fallback).

### F. Real-time channel feed and presence (L)

Move channels from poll to push.

- One multiplexed subscription per client for channel-scoped events (new
  thread, thread status, new message, mention, artifact created, context
  updated). SSE fits the existing stack (`sse-parser.ts`, auth, proxies);
  WebSocket only if bidirectionality is actually needed — it isn't yet.
- Client side: a `channelFeedService` in core that owns the subscription and
  fans out to stores; TanStack Query cache invalidation driven by events
  instead of polling.
- Presence ("who's in this channel / watching this thread") rides the same
  connection. Canvas co-editing conflict (last-write-wins `meta`) gets
  optimistic concurrency (`base_version`) as part of this — full CRDT
  co-editing is explicitly out of scope.
- Depends on A. E's shared visibility benefits from it but streams per-run.

### G. Channels MCP surface (M)

Expose the model to external agents — Slack, Claude, PostHog web.

- MCP tools over the unified model: list/read channels, read CONTEXT.md,
  list threads and artifacts, create a thread in a channel, post to a thread
  (subject to E's steering rules), file an artifact.
- The PostHog MCP server already fronts `desktop-file-system`; this
  workstream is mostly defining the right tool grain and auth (channel
  membership from A) rather than new plumbing.
- Depends on A + B; D and E make it much more useful.

### H. Channel creation, organization, and automations-in-channels (M)

- Agent-suggested channels: when a thread's work doesn't fit its channel (or
  arrives via MCP/Slack with no channel), the agent proposes create-or-file
  rather than silently filing to `#me`. Keep creation cheap and reversible:
  archive, rename (ids are already rename-proof), merge.
- Org conventions vary — resist hard-coding a taxonomy; ship defaults
  (per-product/per-repo starter channels from registered folders) and let
  usage shape it.
- Move loops into channels: scouts gain an optional channel binding so a
  scout's emissions file threads/artifacts into a channel instead of (or in
  addition to) the Signals inbox. This is the "loop → Canvas, PR" thread
  shape and reuses B.

## Sequencing

1. **Now:** A (unify identity) and B (artifact registry) — everything else
   compounds on them. C's summarizer can be prototyped in parallel against
   the existing instructions endpoint.
2. **Next:** C (context lifecycle) and E's grant flow — these deliver the
   "channel is the agent" and "owner steers" halves of the pitch. G alongside,
   since it's mostly surface area.
3. **Then:** F (real-time feed/presence), E's shared visibility, D
   (cross-channel mentions), H.

The multiplayer bets (E, F) are the most speculative and the most expensive;
shipping A–C first means channels are already valuable single-player (durable
context, no re-briefing) before we pay for presence.

## Open product questions

Carried from the positioning discussion; they gate scope, not architecture:

- **Overlap with PostHog Work / web agents:** the unified channel row (A) and
  MCP surface (G) are deliberately host-agnostic so PostHog web can front the
  same channels; whether it should is a product decision to make before G
  ships.
- **How hard to push multiplayer:** E/F sizing above assumes "teams drop into
  the same work context" is a committed bet. If the near-term audience is
  1–5-person teams, the E grant flow + cloud-run visibility may be enough for
  a long time.
- **Generative UI's role:** B treats canvases as one artifact kind among
  several, not the wedge — templates and typed artifacts (plan.md, reports)
  keep output consistent and cheap; freeform canvas stays for the tail.
- **Channel taxonomy:** H ships suggestions and defaults, not enforced
  structure. Watch how design partners organize before doing more.
