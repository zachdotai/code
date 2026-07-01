# @posthog/pi-ext

A [pi](https://pi.dev/) extension that surfaces PostHog Code's **Inbox**, **Scouts**,
**Responders**, and **Tasks** directly in the terminal — no desktop UI required.

Everything is backed by the PostHog Cloud REST API (via `@posthog/signals-client`,
a portable facade over `@posthog/api-client`), so the only thing you need is a
Personal API key.

## What you get

**Slash commands** (interactive dialogs):

- `/inbox` — browse reports; view details; snooze, suppress, or reingest; or
  **work on an item** either locally (a fresh pi session in this repo) or as a
  PostHog cloud task.
- `/scouts` — list the scout fleet with last-run outcome; enable/disable, change
  cadence, toggle dry-run, and drill into runs → emissions.
- `/responders` — toggle the signal sources that feed the inbox.
- `/tasks` — view pi-originated tasks and their latest run's logs.

**LLM-callable tools** (so the agent can reason over signals mid-session):
`signals_inbox_list`, `signals_inbox_get`, `signals_inbox_act`, `scouts_list`,
`scout_toggle`, `responders_list`, `responder_toggle`, `task_create_and_run`,
`task_status`.

**Background poller**: in interactive mode, a status-line badge (`◆ N PostHog`)
tracks inbox items ready for review and notifies you when new ones land.

## Configuration

Set via environment, or write `~/.pi/agent/posthog.json`:

| Env | `posthog.json` key | Default | Notes |
| --- | --- | --- | --- |
| `POSTHOG_API_KEY` | `personalApiKey` | — | **Required.** Personal API key (`phx_…`). |
| `POSTHOG_HOST` | `apiHost` | `https://us.posthog.com` | Use `https://eu.posthog.com` for EU. |
| `POSTHOG_PROJECT_ID` | `projectId` | auto (`/api/users/@me/`) | Numeric project/team id. |
| `POSTHOG_POLL_INTERVAL_MS` | `pollIntervalMs` | `300000` | Inbox poll cadence. |
| `POSTHOG_REPOSITORY` | — | — | `org/repo` attached to cloud tasks. |

Without an API key the extension registers only `/signals:setup`, which prints
these instructions.

## Build & run

```bash
pnpm --filter @posthog/pi-ext build
POSTHOG_API_KEY=phx_… pi -e ./apps/pi-ext/dist/extension.js
```

Or install it as a pi package once published (`pi install npm:@posthog/pi-ext`),
or drop the built file under `~/.pi/agent/extensions/`.
