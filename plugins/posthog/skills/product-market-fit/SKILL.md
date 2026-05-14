---
name: product-market-fit
description: "Help users understand and track product-market fit using PostHog. Trigger when the user asks about PMF, product-market fit, whether their product has fit, how to measure PMF, how to run a PMF survey, who to interview about their product, or wants to set up retention tracking. Also trigger on: 'do we have PMF', 'check our product-market fit', 'set up a PMF dashboard', 'find users to talk to', 'is our retention good', or 'check our survey results'."
---

# Product-Market Fit tracker

## What this skill does

Helps users set up and track product-market fit using the PostHog MCP. It can:
1. **Set up** — create a PMF survey and a retention/engagement dashboard
2. **Check status** — analyze survey results against the 40% threshold and surface trends
3. **Find interviewees** — identify the right users to talk to based on behavior and survey responses

PMF is not a single moment — it's a signal that builds across retention curves, qualitative feedback, and organic growth. This skill measures all three using PostHog data.

---

## Before you start

Make sure the PostHog MCP is connected. If it isn't, tell the user:
> "You'll need the PostHog MCP connected to use this skill. Run `npx @posthog/wizard mcp add` to set it up, then restart Claude Code."

No API keys or project IDs are needed — the MCP handles authentication.

---

## Gather context

Before doing anything else, collect the following. Ask all of these in a single message so the user isn't interrupted mid-task.

**1. Product name** (required)
Used in survey question text. Example: "PostHog", "Acme", "Linear".

**2. Activation event** (required)
The single event that best represents a user reaching their "aha moment" — not a login, but the action where they first get real value. Examples: "analyzed a dashboard", "ran a query", "sent first message", "created first project".

If the user isn't sure, help them find it: use `execute-sql` to list the top 20 most common events performed by users who returned to the product at least 3 times:
```sql
SELECT event, count() AS cnt
FROM events
WHERE timestamp >= now() - interval 90 day
  AND person_id IN (
    SELECT person_id FROM events
    WHERE timestamp >= now() - interval 90 day
    GROUP BY person_id HAVING uniq(toStartOfDay(timestamp)) >= 3
  )
  AND event NOT IN ('$pageview', '$pageleave', '$autocapture', '$identify', 'survey sent')
GROUP BY event
ORDER BY cnt DESC
LIMIT 20
```
Present the results and ask: "Which of these best represents the moment a user first got real value from your product?"

**3. Signup event** (required for activation funnel)
The event that fires when a new user registers. Common values: `user signed up`, `account created`, `$identify`.

Try to find it automatically first using `execute-sql`:
```sql
SELECT event, count() AS cnt
FROM events
WHERE timestamp >= now() - interval 90 day
  AND (
    event ILIKE '%sign%up%'
    OR event ILIKE '%register%'
    OR event ILIKE '%account%creat%'
    OR event ILIKE '%onboard%start%'
  )
GROUP BY event
ORDER BY cnt DESC
LIMIT 10
```
If the result is unambiguous, confirm it with the user ("Looks like your signup event is `user signed up` — does that sound right?"). If unclear, ask them directly.

**4. Ideal Customer Profile (ICP)** (required for ICP retention comparison)
Ask the user to describe their ideal customer in plain language. Examples:
- "B2B SaaS companies, 10–200 employees, engineering or product teams"
- "Solo founders building consumer apps"
- "Enterprise retail companies using Salesforce"

Once they describe it, use `execute-sql` to discover what person properties exist in PostHog that might map to that description:
```sql
SELECT key, count() AS cnt
FROM person_distinct_ids
JOIN (
  SELECT id, JSONExtractKeys(properties) AS keys FROM persons
) ON person_distinct_ids.person_id = id
ARRAY JOIN keys AS key
GROUP BY key
ORDER BY cnt DESC
LIMIT 50
```
Alternatively, use a simpler approach:
```sql
SELECT DISTINCT arrayJoin(JSONExtractKeys(properties)) AS property_key
FROM persons
LIMIT 100
```

Present the available properties and help the user map their ICP description to concrete filters. For example: if they said "B2B SaaS, 10–200 employees" and the properties include `company_size` and `plan`, suggest:
> "`company_size` between 10 and 200, `plan` is not 'free'"

Confirm the final filter expression with the user, then use `cohorts-create` to save it as a cohort named **"ICP Users"** — this cohort will be used throughout the dashboard and interview identification.

---

## Modes

Ask the user which mode they want, or infer from context:

- **"Set up PMF tracking"** → run Mode 1 (survey) and Mode 2 (dashboard) together
- **"Check PMF status" / "How's our PMF looking?"** → run Mode 3
- **"Who should I talk to?" / "Find users to interview"** → run Mode 4
- **"Set up the survey"** → Mode 1 only
- **"Set up the dashboard"** → Mode 2 only

If unclear, ask: "Would you like me to set up PMF tracking from scratch, check your current status, or identify users to interview?"

---

## Mode 1 — Create a PMF survey

Use the `survey-create` MCP tool to create a survey. This is the Superhuman-style PMF survey that Rahul Vohra's team used to go from 22% to 58% "very disappointed" responses.

### The survey questions

**Question 1 (required, rating/multiple choice)**
> "How would you feel if you could no longer use [ProductName]?"
> Options: Very disappointed / Somewhat disappointed / Not disappointed

**Question 2 (open text, shown to all)**
> "What is the main benefit you get from [ProductName]?"

**Question 3 (open text, shown only to "Very disappointed" respondents)**
> "What type of person do you think would most benefit from [ProductName]?"

**Question 4 (open text, shown only to "Very disappointed" respondents)**
> "How could we improve [ProductName] for you?"

### Targeting

Show the survey only to users who have been active in the last 30 days and have used the product at least twice. This avoids surveying one-time visitors who haven't experienced real value.

Use the **activation event** collected in the Gather context step as the targeting condition.

### MCP call

Use `survey-create` with:
- `name`: "Product-Market Fit Survey"
- `description`: "Measures PMF using the Superhuman 'very disappointed' methodology"
- `questions`: the four questions above, with branching logic on Question 1 so Questions 3 and 4 only show to "Very disappointed" respondents
- `targeting_flag_filters`: target users who have performed the engagement event at least twice in the last 30 days

After creating, tell the user:
- They'll need at least **30 responses** before the data is meaningful, and **100+** for high confidence
- To check back in 2–4 weeks once responses accumulate
- They can view and adjust the survey in PostHog under Surveys

---

## Mode 2 — Create a PMF dashboard

Use `dashboard-create` to create a new dashboard, then `insight-create` to add each insight to it. All inputs needed (activation event, signup event, ICP cohort) should already be collected from the Gather context step.

### Create the dashboard

Use `dashboard-create` with:
- `name`: "Product-Market Fit"
- `description`: "Tracks the leading and lagging indicators of PMF: retention, engagement, PMF survey, and organic growth."
- `pinned`: true

### Add these insights

Create each with `insight-create`, then add it to the dashboard. Use `query-trends`, `query-funnel`, or `execute-sql` where a dedicated query tool fits better than a generic insight.

| Insight | Tool | What it measures |
|---|---|---|
| **Retention curve — all users** | `insight-create` (retention type), weekly cohorts, activation event as both the starting and returning event | Flattening = PMF. Falling to zero = no PMF |
| **Retention curve — ICP vs non-ICP** | Two `insight-create` retention insights side by side: one filtered to the "ICP Users" cohort, one filtered to "not in ICP Users" cohort | ICP users should retain significantly better. A large gap confirms you've found the right customer. No gap = ICP definition may be wrong |
| **DAU / WAU stickiness** | `query-trends` with formula DAU/WAU, based on activation event | Stickiness ratio. >20% healthy, >50% exceptional |
| **New user activation rate** | `query-funnel`: signup event → activation event within 7 days | % of new users reaching their "aha moment" |
| **PMF survey score** | `insight-create` linked to the PMF survey, filter "very disappointed" % | Target: 40%+ |
| **Organic vs paid signups** | `query-trends` broken down by `utm_source` is set vs null | Proxy for word-of-mouth growth |
| **Power users this month** | `execute-sql`: count of users with activation event ≥ 10 times in last 30 days | Your most engaged users — protect them |
| **Weekly active users trend** | `query-trends`: unique users doing activation event per week, 12-week view | Overall growth signal |

For the ICP vs non-ICP retention insights: if the gap between ICP and non-ICP retention is large (e.g. ICP week-8 retention is 20%, non-ICP is 4%), call this out explicitly — it's one of the strongest early PMF signals.

---

## Mode 3 — Check PMF status

Query PostHog to assess current PMF health across three areas.

### Part A: Survey results

First use `surveys-get-all` to find the PMF survey ID if the user doesn't know it. Then use `survey-get` to retrieve responses.

Calculate:
- Total responses
- % "Very disappointed" — **this is the key number, target 40%+**
- % "Somewhat disappointed"
- % "Not disappointed"
- Trend: compare last 30 days vs previous 30 days if enough data exists

Use `execute-sql` to run a HogQL query against survey response events if the survey API doesn't return aggregate breakdowns directly. Example:

```sql
SELECT
  properties.$survey_response AS response,
  count() AS count
FROM events
WHERE event = 'survey sent'
  AND properties.$survey_id = '{survey_id}'
  AND timestamp >= now() - interval 30 day
GROUP BY response
```

Read the open-text responses from Questions 2 and 4. Group them by theme and surface the top 3 themes from each — these reveal what users actually value and what they want improved, which is more reliable than what you think they want.

### Part B: Retention check

Use `insight-create` with retention type (or read from the existing dashboard insight) to get cohort retention data. Look for:

- **Flattening curve** — retention stabilizing above 0% at any week (even week 6–8) is a positive PMF signal
- **Falling to zero** — all cohorts fully churn by week 4–6 = no PMF yet
- **Improving across cohorts** — newer cohorts retaining better than older ones = you're getting better

If the dashboard from Mode 2 already exists, use `dashboard-get` to pull the current state rather than re-querying.

### Part C: Engagement trend

Use `query-trends` to get weekly active users (users performing the engagement event) over the last 12 weeks. Assess whether it's growing, flat, or declining.

### Output format

Produce a concise status report:

```
**PMF Status — [Month Year]**

**Survey results** ([N] responses)
• Very disappointed: X% [↑↓ vs last period] — Target: 40%+
• Status: [🟢 At/above 40% | 🟡 30–39% — close | 🔴 Below 30% — significant work needed]

**What users love** (from open responses)
• [Theme 1]: "[representative quote]"
• [Theme 2]: "[representative quote]"

**What users want improved**
• [Theme 1]: "[representative quote]"
• [Theme 2]: "[representative quote]"

**Retention**
• [Week N] retention: X% — curve [flattens / keeps falling]
• Signal: [🟢 Flattening — users are sticking | 🟡 Slow decline | 🔴 Falling to zero]

**Engagement trend (WAU)**
• [Growing X% / Flat / Declining X%] over last 12 weeks

**Overall read**
[2–3 sentence plain-language summary of where they are on the PMF journey and the most important thing to act on]
```

Use the 40% "very disappointed" threshold as the key benchmark. Below 30% = significant changes needed. 30–39% = iterate toward the users who love it. 40%+ = PMF signal, focus on scaling what works.

---

## Mode 4 — Identify users to interview

Good interviews come from talking to the right people. Use `execute-sql` with HogQL to surface four cohorts, then use `cohorts-create` to save them in PostHog for easy reference.

### Cohort 1: Power users who love it ("very disappointed")

These tell you what's actually working. They're your ICP.

```sql
SELECT DISTINCT person_id, argMax(properties.email, timestamp) AS email
FROM events
WHERE event = 'survey sent'
  AND properties.$survey_response = 'Very disappointed'
  AND person_id IN (
    SELECT person_id FROM events
    WHERE event = '{engagement_event}'
      AND timestamp >= now() - interval 30 day
    GROUP BY person_id HAVING count() >= 10
  )
LIMIT 20
```

Interview goal: understand what specific job they're using the product for and what they'd lose if it disappeared.

### Cohort 2: Churned users who were once active

These tell you what's broken or who you're not a fit for.

```sql
SELECT DISTINCT person_id, argMax(properties.email, timestamp) AS email
FROM events
WHERE person_id IN (
    SELECT person_id FROM events
    WHERE event = '{engagement_event}'
      AND timestamp BETWEEN now() - interval 75 day AND now() - interval 45 day
    GROUP BY person_id HAVING count() >= 3
  )
  AND person_id NOT IN (
    SELECT person_id FROM events
    WHERE event = '{engagement_event}'
      AND timestamp >= now() - interval 30 day
  )
LIMIT 20
```

Interview goal: understand what made them stop — missing feature, competitor, or a use case you don't serve.

### Cohort 3: "Somewhat disappointed" users with high engagement

These might become "very disappointed" with the right changes. Converting them is the fastest path to improving your PMF score.

```sql
SELECT DISTINCT person_id, argMax(properties.email, timestamp) AS email
FROM events
WHERE event = 'survey sent'
  AND properties.$survey_response = 'Somewhat disappointed'
  AND person_id IN (
    SELECT person_id FROM events
    WHERE event = '{engagement_event}'
      AND timestamp >= now() - interval 30 day
    GROUP BY person_id HAVING count() >= 5
  )
LIMIT 20
```

Interview goal: understand what's missing for them to love it.

### Cohort 4: Recent signups who activated quickly and match the ICP

These show what's working in onboarding for your best-fit customers. Filtering to ICP makes the signal cleaner.

```sql
SELECT DISTINCT person_id, argMax(properties.email, timestamp) AS email
FROM events
WHERE person_id IN (
    SELECT person_id FROM events
    WHERE event = '{signup_event}'
      AND timestamp >= now() - interval 60 day
  )
  AND person_id IN (
    SELECT e2.person_id FROM events e1
    JOIN events e2 ON e1.person_id = e2.person_id
    WHERE e1.event = '{signup_event}'
      AND e2.event = '{activation_event}'
      AND e2.timestamp BETWEEN e1.timestamp AND e1.timestamp + interval 3 day
  )
  AND person_id IN (
    SELECT person_id FROM cohort_people
    WHERE cohort_id = {icp_cohort_id}
  )
LIMIT 20
```

Interview goal: understand what brought them in and what made them activate fast.

### Output

For each cohort, return:
- How many users qualify
- Top 5 by recency/engagement with person ID and email
- A suggested opening question for interviews with that cohort

Use `cohorts-create` to save each cohort in PostHog so the user can message them or reference them later.

Tell the user: "Start with Cohort 1 — understanding why power users love it is more valuable right now than understanding why others don't. Once you have that, use Cohort 3 to figure out how to convert the 'somewhat disappointed' users."

---

## Periodic check-in (optional automation)

If the user wants to check PMF status regularly, suggest the `schedule` skill for a recurring report. A good cadence:
- **Weekly**: Check survey response volume, flag any trend shifts
- **Monthly**: Full Mode 3 status report

Suggest: "Would you like me to set up a monthly PMF status report? I can schedule this to run automatically using the schedule skill."

---

## Key benchmarks

| Metric | 🔴 Needs work | 🟡 Getting there | 🟢 PMF signal |
|---|---|---|---|
| PMF survey "very disappointed" | < 30% | 30–39% | 40%+ |
| Week 8 retention | < 5% | 5–15% | 15%+ and flattening |
| DAU/WAU stickiness | < 10% | 10–20% | 20%+ |
| New user activation (7d) | < 20% | 20–40% | 40%+ |
| WAU trend (12w) | Declining | Flat | Growing |

These are directional, not absolute. A B2B tool with 30 power users and 80% "very disappointed" has stronger PMF than a consumer app with 10,000 users at 15%.

---

## Example trigger phrases

- "Do we have product-market fit?"
- "Set up PMF tracking for our product"
- "Check our PMF survey results"
- "Create a retention dashboard"
- "Who should I be talking to about our product?"
- "Find me users to interview"
- "How's our PMF looking this month?"
- "Set up a survey to measure PMF"
- "Is our retention good enough?"