---
name: spec-driven-development
description: Use when a task should begin from an explicit feature specification, when requirements are vague, or when a Hedgemony nest goal should be converted into user stories, acceptance scenarios, measurable success criteria, and implementation tasks.
argument-hint: <feature idea | nest goal | file/dir | branch>
allowed-tools: Read, Grep, Glob, Bash
---

# Spec-Driven Development

Use this skill when the work should be driven by a durable spec instead of a loose implementation prompt. The shape is adapted for PostHog Code from GitHub Spec Kit's spec-driven development workflow.

## Tool Use

- Use read/search tools to inspect existing docs, code, tests, and repo conventions before writing a plan.
- Use shell commands for non-mutating context checks such as `git status`, `git diff`, `rg`, and test discovery.
- Do not edit files during the spec phase unless the user explicitly asks you to write or update spec artifacts.
- Do not spawn subagents or start implementation work just because this skill was invoked.
- When this skill is applied outside an agent runtime, inline these rules into the calling prompt; do not assume a skill loader exists.

## Core Posture

- Treat the specification as the source of truth and code as the implementation of that spec.
- Start with what users or operators need and why it matters.
- Keep implementation details out of the feature spec unless they are true constraints.
- Ask clarifying questions when key behavior, scope, success criteria, or data boundaries are missing.
- Carry unresolved uncertainty forward as explicit open questions when the user wants to keep moving.

## Feature Spec Shape

When drafting or refining a spec, use these sections when they fit the work:

- Feature name and short summary
- Primary scenario: who does what, and what changes for them
- User stories in priority order, each independently testable
- Acceptance scenarios using Given, When, Then wording
- Functional requirements with stable IDs such as `FR-001`
- Key entities or domain objects, without implementation-only details
- Assumptions and open questions
- Measurable success criteria with stable IDs such as `SC-001`

## Planning Shape

Once the feature spec is accepted, translate it into a plan that ties technical choices back to requirements:

- Current repo context and existing patterns to reuse
- Architecture or module boundaries
- Data model or persistence changes
- API, tRPC, CLI, or UI contracts
- Testing and validation strategy
- Risks, migrations, rollout, or operational checks

## Task Shape

Break work into independently shippable slices:

- Group tasks by user story or operator-visible behavior.
- Mark tasks that can run in parallel only when they touch different files or responsibilities.
- Include concrete file paths when known.
- Put blocking foundations before user-story implementation.
- Keep a validation checkpoint after each independently demoable story.

## Hedgemony Nest Guidance

When creating or working inside a Hedgemony nest:

- Preserve the accepted nest goal as the spec anchor.
- Use the definition of done as the completion gate.
- Prefer creating hoglets from user stories, acceptance scenarios, and validation tasks.
- If the nest goal is vague, refine the spec before spawning implementation work.
- When implementation reveals drift, update or annotate the spec instead of silently changing scope.
