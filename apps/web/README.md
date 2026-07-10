# @posthog/web

Browser host for PostHog Code. Boots the same `@posthog/ui` shell and
`@posthog/core` services as the desktop app, with web platform adapters —
no Electron, no local workspace-server. Scope today: auth + cloud tasks
(local workspaces, terminal, and local git need a workspace backend and are
out of scope for the web host's first iteration).

## Run

```bash
pnpm --filter @posthog/web dev   # Vite on http://localhost:5273
```

No separate backend process: the host router slice runs in the browser
(`web-host-router.ts`), served over tRPC's `unstable_localLink`
(`web-trpc.ts`). `auth`, `cloudTask`, and `analytics` are the real routers
backed by in-browser `AuthService` / `CloudTaskService` (both are
host-agnostic core code); the rest are stubs that return benign empties.
Procedures outside the slice fail with NOT_FOUND at call time — that is the
to-do list for widening the web surface.

## Auth

`WebOAuthFlowService` (`web-oauth-flow.ts`) implements the core
`IAuthOAuthFlowService` with a browser PKCE flow: popup to
`{cloud}/oauth/authorize`, redirect back to `{origin}/callback`, code relayed
to the opener tab over a BroadcastChannel, token exchange via fetch. Session
persistence is localStorage (`web-auth-adapters.ts`); the refresh token is
stored unencrypted — the browser has no machine-bound key, so the origin
boundary is the protection (same threat model as any origin-scoped
credential).

### External requirements (status as of 2026-07)

- **CORS — no action needed.** Verified against `us.posthog.com`:
  `/oauth/token` answers preflight with the request origin allowed, and
  `/api/*` responds `access-control-allow-origin: *` with `authorization` in
  the allowed headers. The agent-proxy stream service has a CORS origin
  allowlist (`TASKS_AGENT_PROXY_CORS_ORIGINS` in
  `PostHog/posthog/services/agent-proxy`), and `CloudTaskService` falls back
  to the CORS-open Django stream leg regardless.
- **Redirect URI registration — required.** The web host reuses the Code
  ("Array") OAuth application client ids (`packages/shared/src/oauth.ts`).
  Those applications' `redirect_uris` are database rows on each region
  (Django admin → OAuth applications), and must include:
  - `http://localhost/callback` (portless) for development — PostHog's
    authorize view extends RFC 8252 §7.3 loopback port flexibility to
    `localhost` (`posthog/api/oauth/views.py: validate_redirect_uri`), so
    the portless form matches the Vite dev server on any port. It may
    already be registered; if desktop dev builds can sign in to the region,
    check whether the registered localhost URI is portless or pinned to
    `:8237`.
  - `https://<web-origin>/callback` for a deployed web host, once an origin
    exists. `http` is rejected for non-loopback hosts by
    `OAuthApplication` redirect validation.

  A CIMD client (the `raycast_metadata.py` / `wizard_metadata.py` pattern in
  `posthog/api/oauth/`) is NOT suitable here: CIMD registrations are capped
  to unprivileged scopes, and Code requires `scope=*` like the desktop app.
- **S3 artifact-bucket CORS — required for attachment uploads.** Composer
  attachments upload straight from the browser via an S3 presigned POST
  (`.../artifacts/prepare_upload/` returns the presigned post, then a `POST` to
  `s3.<region>.amazonaws.com/<bucket>`). The bucket
  (`posthog-cloud-prod-us-east-1-app-assets` for US) must return
  `Access-Control-Allow-Origin` for the web origin or the browser blocks the
  response — the POST itself returns `204` (it succeeds server-side) but `fetch`
  rejects with a bare `NetworkError`. Desktop (Electron/Node `fetch`) is not
  subject to CORS, so this is web-only. Add the deployed web origin (and
  `http://localhost:5273` for dev) with the `POST` method to the bucket's CORS
  config. Until then, attaching + preview work but sending a task with an
  attachment fails at the upload step.
- **Integration connect origin (`connect_from=posthog_web`) — required for Slack
  / GitHub connect.** PostHog brokers the Slack/GitHub OAuth server-side and,
  once it completes, redirects to a target chosen by the `connect_from` value
  (`posthog_code` → `posthog-code://…`, `posthog_mobile` → `posthog://…`) — a
  per-known-client mapping, not an open redirect. There is no `posthog_web`
  mapping yet. The web host's `startFlow` opens the standard
  `.../integrations/authorize/?kind={slack|github}&next=…&connect_from=posthog_web`
  URL in a tab; no callback relay is needed because the integration is created
  server-side, and the connect hooks refetch `getIntegrations()` on window-focus
  to surface it. This covers the Slack and GitHub *team* flows once the backend
  tolerates/handles `posthog_web`. The GitHub *user* flow
  (`POST /api/users/@me/integrations/github/start/`) additionally hardcodes
  `connect_from: "posthog_code"` in `@posthog/api-client` and returns **400** on
  web — it needs a host-parameterized `connect_from` plus the same backend
  origin support.

## Not yet wired

- **Feature flags + analytics + error tracking** are wired (posthog-js), but
  dormant until `VITE_POSTHOG_API_KEY` is a real `phc_…` key (see the guard in
  `main.tsx`). Feature flags force `SYNC_CLOUD_TASKS_FLAG` on (a host
  requirement) and defer every other flag to posthog-js; with no key, only the
  forced flag is on. Production web builds also get posthog-js automatic
  error/rejection capture and session recording.
- **Attachment uploads** are blocked in the browser by the S3 artifact-bucket
  CORS config (see External requirements) until the web host is served from an
  allowlisted origin. Attaching, preview, and byte-reads all work; only the
  final presigned-POST upload fails.
- **Slack / GitHub connect** is client-wired (`startFlow` opens the authorize
  URL; the connection is detected via the window-focus refetch, not a callback
  relay) but gated on backend support for a `posthog_web` connect origin — see
  External requirements. The GitHub user flow returns 400 on web today. Where a
  project already has the integration connected, the settings pages render the
  connected/manage state correctly.
- **Per-device stores** (cloud workspaces, archive, pins, browser tabs) are
  localStorage-only — not durable across devices or a site-data clear.
- **Skill dependency expansion** is a passthrough: a skill that declares
  `dependencies:` on other skills won't pull them in automatically (pick them
  explicitly). This is a pipeline gap, not just a web gap — `exportSkill` strips
  SKILL.md frontmatter and the team-skills API has no `dependencies` field, so
  the dependency list never reaches any client (desktop only expands local
  on-disk skills). Needs `dependencies` carried end-to-end through
  export → publish → the LlmSkill API (backend) → fetchSkillForInstall.
- The bundle is not yet code-split (single large chunk).
