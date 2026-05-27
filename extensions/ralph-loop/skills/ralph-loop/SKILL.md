---
name: ralph-loop
description: Use Ralph loops for paced, multi-iteration development work in PostHog Code.
---

# Ralph Loop

Use Ralph when the user asks for an iterative loop, repeated autonomous passes, or paced development with checkpoints.

## Tools

- `ralph_start`: start a loop. Provide a concise `name`, a task `description`, and optional pacing fields.
- `ralph_done`: advance the active loop after you have made real progress and updated the `.ralph/<name>.md` task file. Set `completed: true` only when the task is fully complete.

## Workflow

1. Start with `ralph_start` if no loop exists yet.
2. Work on the current iteration's checklist items.
3. Update the task file with progress and verification evidence.
4. If fully complete, call `ralph_done` with `completed: true` and then respond with `<promise>COMPLETE</promise>`.
5. Otherwise call `ralph_done` without `completed` to get the next iteration prompt.

Do not call `ralph_done` if you did not make real progress or if you already emitted the completion marker.
