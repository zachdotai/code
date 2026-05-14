---
name: competitor-changelog-tracker
description: "Research and summarise recent activity from a list of competitors. Use this skill whenever the user wants to know what competitors have been up to, asks about competitor updates, changes, or news, mentions \"competitor research\", \"what's changed\", \"what are [company] doing\", or provides a list of companies to check up on. Also trigger when the user asks to \"run a competitor check\" or similar. The user will provide competitor names (and optionally URLs); Claude will check their blog/changelog, job postings, social media, and GitHub, then return a Slack-ready summary."
---
 
# Competitor changelog tracker
 
## What this skill does
 
Checks 4–8 competitor companies across multiple public sources and produces a concise, Slack-ready summary of what's changed recently. The user provides a list of competitors; Claude does the research.
 
## Inputs
 
The user will provide:
- A list of competitor names (required)
- Optionally: specific URLs for any of them (e.g. their changelog page)
- Optionally: a timeframe (default to "last month" if not specified)
If the user hasn't provided a list yet, ask: "Which competitors should I check? Just list their names — I'll find the rest."
 
## Sources to check
 
For each competitor, search and fetch from these sources in order:
 
1. **Blog / changelog** — search `[company] changelog OR blog OR "what's new" OR "product updates" site:[theirdomain] after:[start-date]`. If you know or can find their changelog URL directly, fetch it.
2. **Job postings** — search `[company] jobs site:linkedin.com/jobs OR site:greenhouse.io OR site:lever.co after:[start-date]` — look for clusters of new roles that signal strategic direction.
3. **Social media / X** — search `from:[theirhandle] since:[start-date]`. Use the handle, not just the company name — name-only searches are too noisy.
4. **GitHub** — search `[company] github` to find their org, then look at recently tagged releases and changelogs, not just repo activity.
You don't need to exhaustively read every source. Skim for signals — new features, pricing changes, hiring patterns, strategic shifts, notable customer wins or losses.
 
## What to look for
 
Flag anything in these categories:
- **New features or product launches**
- **Pricing changes**
- **Strategic shifts** (new market, new ICP, rebrand)
- **Hiring signals** — distinguish between:
  - *Net-new role clusters*: multiple new role types appearing together = expansion into a new area
  - *Backfill patterns*: high volume of the same role = replacement/churn, not growth
  - *Leadership hires*: new VP/C-suite in a function = strategic shift in that area
- **Notable announcements** (funding, partnerships, acquisitions)
If nothing notable has happened for a competitor, say so briefly — don't pad it out.
 
## Output format
 
Produce a Slack-ready summary using this structure:
 
```
*Competitor update — [Month Year]*
 
*[Competitor 1]*
• [direct] Launched X — blog post 2026-04-28
• [inferred: hiring] 4 new enterprise AE roles posted — no direct announcement
• [corroborated: blog + 2 news outlets] Raised $50M Series C — 2026-04-15
 
*[Competitor 2]*
• [Signal] [evidence type] finding — date
 
...
 
_Checked: blog, jobs, X, GitHub — [date range]_
```
 
Rules for the output:
- Use Slack markdown (`*bold*`, `_italic_`, bullet points with `•`)
- Every bullet must include: the signal emoji, an evidence tag (`[direct]`, `[inferred: hiring]`, `[inferred: pattern]`, or `[corroborated: sources]`), the finding, and the date (or `date unverified` if you can't confirm it)
- Keep each bullet to one sentence — ruthlessly concise
- Lead with the most interesting finding per competitor
- If a competitor had no notable activity, write: `• Nothing significant this period`
- End with a one-line "most interesting thing overall" callout, e.g. `_Worth watching: Acme Corp appears to be moving into enterprise — 6 new enterprise AE roles posted this week._`
## Accuracy and verification rules
 
- **Verify dates before including anything.** Only include findings where you can confirm the publish date falls within the specified timeframe. If you can't confirm the date, include the finding but mark it `date unverified`.
- **Label the evidence type on every bullet** — `[direct]` for the company's own announcement, `[inferred: hiring]` or `[inferred: pattern]` for signals you're reading into, `[corroborated: X + Y]` when multiple independent sources report the same thing.
- **Weight corroborated findings higher.** If the same news appears in both the company blog and external sources, it's more reliable than a single source — note the corroboration.
- **Don't conflate inferred signals with direct announcements.** "Moving into enterprise" is inferred from job postings; say so. Don't present it as confirmed strategy unless the company has stated it directly.
- If you can't find a competitor's website or social handle, prompt the user to provide that information
- If a source returns no useful results, skip it silently — don't list "checked X, found nothing" for every source
- Don't fabricate findings. If genuinely uncertain, mark it `date unverified` or `[inferred]` rather than omitting or asserting
 
## Example trigger phrases
 
- "Can you do a competitor check?"
- "What have [Company A] and [Company B] been up to lately?"
- "Run the competitor tracker — here's my list: ..."
- "Anything new from our competitors this month?"