---
name: skill-writer
description: Create new skills, modify and improve existing PostHog Code skills, and help users design recurring scheduled tasks that read like skills (clear intent, scoped output, predictable trigger). Use when the user wants to author a new skill from scratch, edit or refine an existing skill, optimize a skill's description for better triggering, or draft a scheduled task in PostHog Code — including suggesting cron schedules and brainstorming what the task should do.
---

# Skill Writer

A skill for creating new PostHog Code skills, iteratively improving them, and helping users design well-shaped recurring tasks (scheduled tasks) that follow the same principles as good skills.

## When this skill triggers

Use this skill whenever the user is:

- Creating a new skill from scratch for PostHog Code
- Editing or improving an existing skill in `plugins/posthog/skills/` (or `local-skills/`)
- Trying to design a recurring scheduled task — they want help drafting the **prompt** and picking a **schedule** (cron)
- Asking "what should I schedule?" or "what would be useful to run on a schedule?"
- Asking how to phrase a task so an LLM reliably picks the right approach when it fires

The same principles apply to both: a good skill and a good scheduled task both have a clear intent, a tight scope, and predictable triggers/inputs.

## Two related but distinct outputs

This skill helps you produce one of two things. Confirm which up front:

1. **A SKILL.md** — a markdown file that gets bundled into the PostHog plugin and tells the agent how to do a class of tasks (e.g. "draft a feature flag rollout plan").
2. **A scheduled task** — a *name*, a *prompt*, a *cron schedule*, and optionally a *list of data sources* (PostHog MCP servers) the agent should reach for. The user creates these from the Work → Scheduled Tasks screen.

The workflows overlap (capture intent → draft → test → iterate) but the deliverable is different. Stay explicit about which one you're producing so the user doesn't end up with a SKILL.md when they wanted a cron entry.

## Communicating with the user

PostHog Code users range from "first time touching a terminal" to "veteran SRE". Read context cues for jargon level.

Default safe vocabulary:
- "schedule" and "recurring task" — fine for everyone
- "cron expression" — fine if they're showing comfort with config; otherwise paraphrase ("every weekday at 9am")
- "MCP server" / "data source" — the Work UI calls them "data sources"; prefer that
- "evaluation" / "benchmark" — borderline; explain briefly if introducing
- "JSON" / "assertion" — wait for cues that they know these before using

Be conversational. Briefly define a term inline if you're unsure.

---

## Part 1: Drafting a scheduled task

Most Work users will arrive here wanting a scheduled task, not a skill. Prioritise this flow.

### Capture intent

Pull whatever the user already gave you out of the conversation history. Then fill the gaps. Aim for the following before you propose anything:

1. **What outcome do they want?** Ask "what would 'done' look like the next time this runs?" — a sent Slack summary, a comment on a PR, a row added to a sheet, an alert if something looks wrong, etc.
2. **What triggers should the task look at?** Are they reacting to a metric, a time window, a stream of events, a state in PostHog?
3. **What should it skip / ignore?** Bound the task. ("Only weekdays.", "Only this product area.", "Ignore internal users.") This is where most flaky tasks fail.
4. **How often should it run?** If they don't know, suggest a default based on the cadence of the underlying signal (more on this below).
5. **What data sources will it need?** Map to the data sources picker in the Work UI — Web analytics, error tracking, replays, LLM analytics, warehouse, etc.

### Suggesting a schedule

Don't ask the user for a cron expression. Suggest two or three sensible options based on the work:

- **Daily summary of yesterday** → `0 9 * * *` (every day at 9am local time)
- **Weekly digest** → `0 9 * * MON` (Mondays at 9am)
- **Hourly drift check** → `15 * * * *` (every hour at :15 so it doesn't compete with on-the-hour traffic)
- **Pre-meeting prep** → `0 8 * * 1-5` (weekdays at 8am)
- **Rare / exceptional check** (e.g. monthly billing audit) → `0 9 1 * *` (1st of each month at 9am)

Phrase your proposal in plain English first ("Mondays at 9am, your time"), then show the cron in parentheses so the user can keep it if they like.

If the user mentions a time window in the work itself ("look at the last 24 hours"), match the cron to that window. A weekly summary that looks at the last 24 hours is a bug.

### Suggesting ideas

When the user is vague ("something useful with PostHog data"), proactively pitch 3–5 concrete scheduled task ideas grounded in what their project has. Examples to inspire — pick what matches:

- "Each morning, summarise yesterday's new error tracking issues with > N occurrences and post a digest."
- "Weekly: list feature flags that are still rolled out to a fraction and haven't moved in 30 days; flag candidates for cleanup."
- "Daily: check core funnel conversion vs. the trailing 7-day average; alert if it drops by > X%."
- "Each Monday: top 10 pages by traffic last week, with week-over-week change."
- "Weekly digest of LLM spend by model and feature, called out if anything spiked."

Pitch ideas as questions, not assertions — "Would something like X be useful?" Don't write the full prompt until they pick a direction.

### Writing the scheduled task prompt

A scheduled task prompt has two jobs: tell the agent **what to produce** and **what to look at**. Use this rough shape:

```
[Goal in one sentence.]

Look at: [exact data range / source / filter].
Skip: [explicit exclusions, especially edge cases that bit them before].
Output: [where it goes — Slack channel, comment on issue, file in repo — and the exact shape].

If [edge case], do [fallback]. If [signal too noisy], do [other fallback].
```

Why this shape works:
- **Goal first** so the agent doesn't lose track if context gets tight.
- **Look at / Skip / Output** are imperative and scannable — the agent can re-read them and self-correct.
- **Fallbacks** at the bottom keep the happy path clean while still giving the agent a path on the bad day.

Don't pad. A 6-line prompt that's specific beats a 30-line prompt full of hedges.

### Reviewing before saving

Before the user commits, show them:

1. The **name** (short, scannable in a list — "Weekly flag cleanup", not "Audit feature flags weekly with the goal of...").
2. The **schedule** in plain English + cron.
3. The **prompt body** rendered verbatim.
4. The **data sources** you're suggesting they tick.

Ask: "Want me to refine anything before you save it?" Lots of users will tweak the schedule on the first pass.

### After it's saved

Suggest they hit **Run now** once from the editor — it runs in Work mode and they can see the agent's output and approve any permissions before the first scheduled run fires. Mention that if it fails, the row in the list will show the error inline.

---

## Part 2: Drafting or improving a skill

Use this when the user explicitly wants a skill in `plugins/posthog/skills/` (the kind that ships with PostHog Code and triggers by description).

### Capture intent

1. **What should this skill enable the agent to do?** One sentence.
2. **When should it trigger?** What user phrases or contexts? The description is the *only* mechanism that decides whether the skill loads — be specific.
3. **What's the output format?** If there is one — a report, a code change, a JSON blob, a chart.
4. **Are objective test cases worth it?** Skills with verifiable outputs (file transforms, data extraction, code generation, fixed workflow steps) benefit from test cases. Skills with subjective outputs (writing style, design taste) usually don't — focus on qualitative review there.

### Write the SKILL.md

Frontmatter:

- **name**: directory-name style (`auditing-experiments-flags`, not `Auditing Experiments And Flags`).
- **description**: when to trigger + what it does. This is the single most important line for whether the skill ever runs. Currently the agent under-triggers — be slightly pushy:
  - Bad: "How to investigate metric anomalies."
  - Better: "Diagnose why a product metric changed. Use whenever the user reports an anomaly, asks 'why did X change?', or needs root-cause analysis for a trend, funnel, retention, stickiness, or lifecycle metric."

Body (under 500 lines as a soft cap):

- Lead with **when to use** (even though it's in the description, restating it shapes the agent's behaviour once loaded).
- Use **imperative** instructions ("Read X", "Check Y", "Report Z") not declarative ("This skill reads X").
- Explain **why** non-obvious steps matter. Today's models have good theory of mind — they will follow instructions better when they understand the reason. If you find yourself writing ALWAYS or NEVER in caps, that's a yellow flag; reframe and explain the reason instead.
- Keep examples concrete and PostHog-specific. Real table names, real product names, real URL patterns are better than `<thing>` placeholders.
- For things the skill repeats every invocation (a specific query, a specific report shape), put them in `scripts/` or `references/` and point to them.

### Layout

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
└── (optional)
    ├── scripts/    — executable helpers (Python, bash) the skill should run instead of reimplementing
    ├── references/ — long-form docs the skill can pull in on demand
    └── assets/     — templates, icons, fixtures
```

Reference files explicitly from SKILL.md with a one-line "read this when X" pointer.

### Test prompts

After a draft, write 2–3 test prompts a real user would type. Show them to the user before running ("Do these look right, or do you want to add more?"). Run with the skill loaded.

For most PostHog Code skills, the test loop is qualitative — read the agent's transcript, sanity-check that it called the right tools and produced the right shape, iterate the skill. Don't force quantitative evals onto subjective work.

### Iterating

Read the *transcript*, not just the final output. The most common failure mode is the skill making the agent do unnecessary work — re-deriving something it already had, double-checking obvious things, asking the user a question the skill already answered. If you see that pattern, trim.

Generalise from feedback. The skill will be used a thousand times across many prompts; resist over-fitting to the test cases the user happened to pick. If a stubborn issue keeps recurring, try a different framing or metaphor instead of adding more rules.

### Description optimisation (optional)

After the body is good, the description is what determines whether the skill ever triggers. If the user wants to invest more time, draft 20 trigger eval queries — a mix of *should-trigger* and *should-not-trigger* — and walk through them with the user.

The most valuable should-not-trigger queries are *near-misses*: queries that share keywords with the skill but actually need something different. "Format this data" is a poor should-not-trigger for a CSV-export skill; "format my ESLint config" is a much better one.

---

## Patterns the user will notice

Across both flows, a few things consistently lift quality:

- **Lead with the goal, not the steps.** Whether it's a skill body or a scheduled task prompt, the first line should be the outcome. The model uses it as an anchor.
- **Bound the work with explicit "skip" clauses.** Most flaky outputs come from missing exclusions, not missing inclusions.
- **State the output shape.** A vague "summarise X" produces a different shape every time. "Output as a 5-bullet Slack message starting with the headline number" gives the agent a target.
- **Give the agent a fallback.** "If there's no relevant data, post a single line saying so" beats a frustrated agent inventing content.

## When to push back

If the user asks for something the schedule/skill format can't reliably deliver — e.g. a scheduled task that requires real-time user input, or a skill that depends on knowledge not in the project — say so plainly and propose an alternative. A polite "this won't work well as a recurring task because X, but Y would" is more helpful than producing a fragile thing.
