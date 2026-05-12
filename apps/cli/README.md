# posthog-code CLI

CLI for starting and monitoring PostHog Code cloud tasks.

## Installation

```sh
pnpm --filter @posthog/code-cli build
# The binary is at apps/cli/dist/main.js, or link it:
pnpm link --global
```

## Authentication

### Interactive login (browser OAuth)

```sh
posthog-code login              # US region (default)
posthog-code login --region eu  # EU region
```

This opens your browser, completes OAuth, and stores credentials at `~/.config/posthog-code/credentials.json` (mode 600). Access tokens are refreshed automatically.

```sh
posthog-code logout  # removes stored credentials
```

### CI / env vars

Set these instead of running `login`:

| Variable | Description |
|---|---|
| `POSTHOG_API_KEY` | Personal API key or access token |
| `POSTHOG_PROJECT_ID` | Numeric project (team) ID |
| `POSTHOG_HOST` | Optional — defaults to `https://us.posthog.com` |

Env vars take precedence over stored credentials.

## Commands

### `start`

Create and launch a new cloud task.

```sh
posthog-code start "<prompt>"
posthog-code start "<prompt>" --repo org/repo
posthog-code start "<prompt>" --watch
```

Options:

| Flag | Description |
|---|---|
| `-r, --repo <owner/repo>` | GitHub repository to target |
| `-w, --watch` | Stream live output after starting |

Without `--watch`, the command prints the task ID and run ID then exits. The task continues running in the cloud.

### `status`

Check on an existing task, stream output, or answer pending questions.

```sh
posthog-code status <task-id>
posthog-code status <task-id> --watch
posthog-code status <task-id> --interactive
posthog-code status <task-id> --run-id <run-id>
```

Options:

| Flag | Description |
|---|---|
| `--run-id <id>` | Target a specific run (defaults to latest) |
| `-w, --watch` | Stream live output until the run finishes |
| `-i, --interactive` | Watch and respond to permission requests / questions via stdin |

`--interactive` implies `--watch`. Use it when you need to unblock a task that's waiting on approvals. The SSE stream causes the agent to route questions to the terminal rather than auto-approving them. Buffered questions from before you connected are replayed on attach, so you can answer them retroactively.

## Examples

```sh
# Start a task and walk away
posthog-code start "Fix the flaky test in billing/checkout_test.py"

# Start and tail output
posthog-code start "Refactor UserService to use the new auth library" --watch

# Check on a task later
posthog-code status task_abc123

# Tail it
posthog-code status task_abc123 --watch

# Answer a pending permission request
posthog-code status task_abc123 --interactive

# Pin to a specific run
posthog-code status task_abc123 --run-id run_xyz789 --watch
```

## Output

Log output follows the ACP notification format from the agent. The CLI surfaces:

- Agent messages (the actual LLM output)
- Status transitions (`working`, `completed`, `failed`, etc.)
- Task notifications and branch creation events
- Errors (written to stderr)

Idle heartbeats and internal thought chunks are suppressed.
