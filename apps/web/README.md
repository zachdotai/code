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

## Not yet wired

Feature flags and analytics are no-op stubs (posthog-js later). Task
creation/list views need `TASK_SERVICE`/`TASK_CREATION_HOST` bindings; diff
review needs `DIFF_WORKER_FACTORY`/`REVIEW_HOST`. Per-device task metadata
(pins, last-viewed) has no store. The bundle is not yet code-split.
