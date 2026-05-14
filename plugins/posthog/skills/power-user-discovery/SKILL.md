---
name: power-user-discovery
description: "Identify and profile power users from PostHog data. Trigger when the user asks who their most engaged users are, wants to find power users, asks about top users, heavy users, or most active users, wants to build a power user cohort, asks 'who uses the product most', 'who are our best users', 'find users to interview about advanced features', or mentions 'champion users', 'super users', or 'user champions'. Also trigger when the user wants to set up power user tracking or a power user dashboard."
---

# Power user discovery

## What this skill does

Surfaces the most engaged users in PostHog using a composite score across four behavioral dimensions:

1. **Frequency** — how often they log in (distinct active days)
2. **Depth** — how much time they spend in the app (session duration)
3. **Value actions** — how often they complete high-value events
4. **Feature breadth** — how many distinct event types they use (signals broad adoption beyond a single workflow)

The result is a ranked list of power users with a breakdown by dimension, saved as a cohort in PostHog for easy follow-up.

---

## Before you start

Make sure the PostHog MCP is connected. If it isn't, tell the user:
> "You'll need the PostHog MCP connected to use this skill. Run `npx @posthog/wizard mcp add` to set it up, then restart Claude Code."

No API keys or project IDs are needed — the MCP handles authentication.

---

## Gather context

Before running any analysis, collect the following. Ask all of these in a single message so the user isn't interrupted mid-task.

**1. Key value events** (required)
The events that represent high-value actions in the product — not pageviews or clicks, but the things a user does when they're getting real value. Examples: "exported report", "ran analysis", "published campaign", "created pipeline".

If the user isn't sure, help them find candidates using `execute-sql`:
```sql
SELECT event, count() AS cnt
FROM events
WHERE timestamp >= now() - interval 30 day
  AND event NOT IN ('$pageview', '$pageleave', '$autocapture', '$identify', '$set', 'survey sent', '$feature_flag_called')
  AND person_id IN (
    SELECT person_id FROM events
    WHERE timestamp >= now() - interval 30 day
    GROUP BY person_id HAVING uniq(toStartOfDay(timestamp)) >= 5
  )
GROUP BY event
ORDER BY cnt DESC
LIMIT 30
```
Present the results and ask: "Which of these represent your most valuable user actions? Pick 1–5."

**2. Score weights & dimension exclusions** (required — confirm even briefly)
The composite score uses four dimensions with these default weights:

| Dimension | Default weight |
|---|---|
| Value actions | 35% |
| Frequency (active days) | 25% |
| Time in app | 25% |
| Feature breadth | 15% |

Ask the user:
> "I'll score users across value actions, frequency, time in app, and feature breadth with weights of 35 / 25 / 25 / 15. Would you like to adjust the weights or exclude any dimension? Defaults work for most products."

Guidance to offer if they're unsure:
- **Low-frequency products** (used once a week by design): bump value actions and feature breadth, reduce frequency.
- **High-frequency, shallow apps** (e.g. utilities): bump feature breadth, reduce time in app.
- **Collaboration-heavy / team-seat products**: the user may want to manually add a virality dimension (invites sent, mentions, shares) — ask for the relevant event if so.

If a dimension is excluded, redistribute its weight proportionally across the remaining dimensions so weights still sum to 100. Confirm the final weights back to the user before running.

**3. Time window** (required — ask if not specified)
If the user hasn't mentioned a time period, ask before proceeding:
> "What time window should I use? For example: last 30 days, last 60 days, or a specific date range. I'll default to 30 days if you're not sure."

Common options:
- **30 days** — default, good for most products with regular usage
- **60–90 days** — better for newer products with less data, or lower-frequency use cases
- **Custom range** — use `timestamp BETWEEN '{start_date}' AND '{end_date}'` in queries

Do not silently default — always confirm the window with the user, even briefly ("Running the analysis over the last 30 days — let me know if you'd like a different period"). Users often have a specific sprint, quarter, or cohort window in mind.

---

## Run the analysis

Run each dimension as a separate query, then combine them into a composite score. Use `execute-sql` for all of these.

### Dimension 1 — Login frequency (distinct active days)

```sql
SELECT
  person_id,
  argMax(properties.email, timestamp) AS email,
  argMax(properties.name, timestamp) AS name,
  uniq(toStartOfDay(timestamp)) AS active_days,
  uniq($session_id) AS session_count
FROM events
WHERE timestamp >= now() - interval 30 day
GROUP BY person_id
ORDER BY active_days DESC
LIMIT 50
```

### Dimension 2 — Time in app (sum of session durations)

```sql
SELECT
  person_id,
  round(sum(session_minutes), 0) AS total_minutes_in_app
FROM (
  SELECT
    person_id,
    $session_id,
    dateDiff('minute', min(timestamp), max(timestamp)) AS session_minutes
  FROM events
  WHERE timestamp >= now() - interval 30 day
    AND $session_id != ''
  GROUP BY person_id, $session_id
  HAVING session_minutes <= 480
)
GROUP BY person_id
ORDER BY total_minutes_in_app DESC
LIMIT 50
```

The `HAVING session_minutes <= 480` cap (8 hours) filters out sessions where the tab was left open overnight, which would otherwise inflate the time metric.

### Dimension 3 — High-value event completions

Replace `{key_event_1}`, `{key_event_2}`, etc. with the events collected in the Gather context step.

```sql
SELECT
  person_id,
  count() AS valuable_event_count
FROM events
WHERE event IN ('{key_event_1}', '{key_event_2}')
  AND timestamp >= now() - interval 30 day
GROUP BY person_id
ORDER BY valuable_event_count DESC
LIMIT 50
```

### Dimension 4 — Feature breadth (distinct event types used)

```sql
SELECT
  person_id,
  uniq(event) AS distinct_event_types
FROM events
WHERE timestamp >= now() - interval 30 day
  AND event NOT IN ('$pageview', '$pageleave', '$autocapture', '$identify', '$set', 'survey sent', '$feature_flag_called')
GROUP BY person_id
ORDER BY distinct_event_types DESC
LIMIT 50
```

The exclusion list matches the value-event discovery query above so noise events don't inflate breadth.

### Composite power score

Run this query to combine all four dimensions into a single normalized score. Default scoring weights:
- Value actions: **35%** — the strongest signal of a genuine power user
- Frequency: **25%** — habitual use matters
- Time in app: **25%** — depth of engagement
- Feature breadth: **15%** — broad adoption across the product

Use whatever weights the user confirmed in the context-gathering step. If a dimension was excluded, drop its CTE and redistribute its weight proportionally across the remaining dimensions so they still sum to 100.

```sql
WITH
  freq AS (
    SELECT
      person_id,
      argMax(properties.email, timestamp) AS email,
      argMax(properties.name, timestamp) AS display_name,
      uniq(toStartOfDay(timestamp)) AS active_days,
      uniq($session_id) AS session_count
    FROM events
    WHERE timestamp >= now() - interval 30 day
    GROUP BY person_id
  ),
  time_in_app AS (
    SELECT
      person_id,
      round(sum(session_minutes), 0) AS total_minutes
    FROM (
      SELECT
        person_id,
        $session_id,
        dateDiff('minute', min(timestamp), max(timestamp)) AS session_minutes
      FROM events
      WHERE timestamp >= now() - interval 30 day
        AND $session_id != ''
      GROUP BY person_id, $session_id
      HAVING session_minutes <= 480
    )
    GROUP BY person_id
  ),
  value_actions AS (
    SELECT
      person_id,
      count() AS valuable_count
    FROM events
    WHERE event IN ('{key_event_1}', '{key_event_2}')
      AND timestamp >= now() - interval 30 day
    GROUP BY person_id
  ),
  breadth AS (
    SELECT
      person_id,
      uniq(event) AS distinct_types
    FROM events
    WHERE timestamp >= now() - interval 30 day
      AND event NOT IN ('$pageview', '$pageleave', '$autocapture', '$identify', '$set', 'survey sent', '$feature_flag_called')
    GROUP BY person_id
  ),
  combined AS (
    SELECT
      f.person_id,
      f.email,
      f.display_name,
      f.active_days,
      f.session_count,
      coalesce(t.total_minutes, 0) AS total_minutes,
      coalesce(v.valuable_count, 0) AS valuable_count,
      coalesce(b.distinct_types, 0) AS distinct_types
    FROM freq f
    LEFT JOIN time_in_app t USING (person_id)
    LEFT JOIN value_actions v USING (person_id)
    LEFT JOIN breadth b USING (person_id)
    WHERE f.email IS NOT NULL AND f.email != ''
  ),
  maxvals AS (
    SELECT
      max(active_days) AS max_days,
      max(total_minutes) AS max_minutes,
      max(valuable_count) AS max_valuable,
      max(distinct_types) AS max_types
    FROM combined
  )
SELECT
  c.person_id,
  c.email,
  c.display_name,
  c.active_days,
  c.session_count,
  c.total_minutes,
  c.valuable_count,
  round(if(c.session_count > 0, c.valuable_count / c.session_count, 0), 2) AS value_actions_per_session,
  c.distinct_types,
  round(
    (if(m.max_days > 0, c.active_days / m.max_days, 0) * 25) +
    (if(m.max_minutes > 0, c.total_minutes / m.max_minutes, 0) * 25) +
    (if(m.max_valuable > 0, c.valuable_count / m.max_valuable, 0) * 35) +
    (if(m.max_types > 0, c.distinct_types / m.max_types, 0) * 15)
  , 1) AS power_score
FROM combined c
CROSS JOIN maxvals m
ORDER BY power_score DESC
LIMIT 25
```

If the user excluded a dimension during context gathering, drop its CTE and the corresponding term from the score expression, then redistribute its weight proportionally across the remaining dimensions so the total still sums to 100.

---

## Output format

Present a summary in this structure:

```
**Power users — last 30 days**

**Top 10 by composite score**

| Rank | User | Active days | Time in app | Value actions | Value/session | Breadth | Score |
|------|------|-------------|-------------|---------------|---------------|---------|-------|
| 1 | user@example.com | 22/30 | 4h 20m | 87 | 3.6 | 18 | 94.2 |
| 2 | ... | ... | ... | ... | ... | ... | ... |

**Dimension leaders**
• Most frequent: [user] — logged in 28/30 days
• Most time in app: [user] — 9h 15m total
• Most value actions: [user] — 142 [event name] events
• Broadest usage: [user] — used 24 distinct event types
• Most concentrated: [user] — 8.3 value actions per session

**Signals worth noting**
[2–3 sentences highlighting anything unusual: e.g. a user with very high frequency but zero value actions (potential bot or passive user), or a user ranking top-3 in all four dimensions (potential case study candidate)]
```

Keep the table to 10 rows.

**Identified users only:** The composite query already filters out persons without an email so unidentified visitors and bots never reach the report. After running, note how many unidentified persons would have appeared in the raw ranking (compare a count of all top-25 candidates vs identified ones) and suggest the user check their `posthog.identify()` calls if the gap is large.

---

## Create a cohort

After surfacing the results, use `cohorts-create` to save the top power users as a cohort in PostHog.

Suggested cohort definition: users who appeared in the top 25 composite score list. Name it **"Power Users — [Month Year]"**.

Tell the user:
- The cohort will appear in PostHog under Cohorts and can be used for targeting, messaging, or further analysis
- It can be used as an audience in feature flags to give power users early access to new features
- Power users are often the best candidates for interviews, beta programs, or case studies

---

## Create a dashboard (optional)

If the user wants ongoing power user monitoring, use `dashboard-create` and `insight-create` to build a dashboard.

### Create the dashboard
Use `dashboard-create` with:
- `name`: "Power User Tracking"
- `description`: "Tracks the size, composition, and behavior of the top power user cohort over time."

### Add these insights

| Insight | How | What it measures |
|---|---|---|
| **Power user count over time** | `query-trends` — users performing key events ≥ 10x per week | Growing cohort = product is deepening engagement |
| **Top value events leaderboard** | `execute-sql` — top 20 users by key event count this month | Who's most active right now |
| **Power user retention** | `insight-create` (retention type), filtered to Power Users cohort | Are your best users sticking? |
| **Feature breadth growth** | `execute-sql` — avg distinct event types per power user, weekly | Are power users adopting more of the product over time? |
| **Power user % of WAU** | `execute-sql` — power users / total WAU | Is your power user base growing as a share of overall users? |

---

## Offer a user-interview survey (optional)

After the cohort step, offer to create a PostHog survey that invites the top 10 power users to a user interview. Ask the user:

> "Want me to create a survey asking the top 10 power users if they'd be open to a user-interview call? I'll target it precisely to those users, and the survey copy will tell them they're one of your top users."

If they say yes, use `survey-create` (run `info survey-create` first to confirm the schema) with the following defaults — confirm any free-text values before submitting:

- **Type**: `popover` (least intrusive, can be shown after a `$pageview` so it doesn't interrupt a power user mid-flow).
- **Name**: "Power user interview — [Month Year]".
- **Description**: "Targeted invite for our top 10 power users to chat with the team."
- **Targeting**: a static cohort containing exactly the top 10 person IDs from the composite score (create it with `cohorts-create` and name it "Power user interview — top 10 [Month Year]" if no cohort exists yet; otherwise reuse the cohort built in the previous step but cap to the top 10 IDs).
- **Display conditions**: show once per user, cap total responses at 10.
- **Questions** (single multiple-choice question with an optional follow-up):
  1. *"You're one of our top 10 power users — we'd love to learn from you. Would you be willing to do a 30-minute user interview so we can ask how we can make the product better for you?"*
     - Choices: "Yes — happy to chat", "Maybe — send me details", "Not right now".
  2. *Open text follow-up (shown if they pick Yes or Maybe):* "What's the best email or calendar link to reach you on?"

Tell the user:
- The survey will only appear for the exact top 10 cohort — no other users will see it.
- Power users tend to respond at much higher rates than broad surveys, so a low ask cap (10 responses) is realistic.
- Recommend pairing it with a follow-up plan: who on the team will reach out, and what the interview script will cover.

If the user declines, skip the step and continue.

---

## Interpreting the results

**High frequency, low value actions**: User logs in often but doesn't complete valuable actions — possible passive user or someone stuck in onboarding. Consider reaching out to understand their use case.

**High value actions, low frequency**: Infrequent but high-intensity sessions — could be a batch/periodic use case. Not necessarily a problem; understand their workflow before assuming low engagement.

**High breadth, moderate frequency**: User has explored many features but doesn't use any single one heavily — likely a thorough evaluator or a champion mapping the product to a workflow. Good interview candidate for "what almost made you stick" insight.

**High value actions per session**: Concentrated power users — they get a lot done each time they show up. Often the best candidates for advanced-feature interviews.

**Top-ranked across all dimensions**: Ideal case study or reference customer candidate. These users have the clearest signal that the product is deeply embedded in their workflow.

---

## Example trigger phrases

- "Who are our power users?"
- "Find me the most engaged users in PostHog"
- "Which users use the product the most?"
- "Create a power user cohort"
- "Who should I talk to about our advanced features?"
- "Show me our top users this month"
- "Set up power user tracking"
- "Who are our super users?"