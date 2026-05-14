---
name: important-slack-threads
description: "Scan Slack for the most significant threads from the last 7 days — long discussions, controversial debates, or unresolved decisions. Trigger when the user asks about important Slack threads, wants a weekly Slack digest, asks 'what did I miss', 'what's been happening on Slack', 'summarize the week in Slack', 'what was controversial this week', 'which decisions were made', 'what's unresolved', or mentions 'long threads', 'big threads', 'heated threads', or 'Slack roundup'."
---

# Important Slack threads

## What this skill does

Scans Slack over the last 7 days, surfaces the threads that *mattered* (long, controversial, or decision-shaped), summarizes each, and explicitly flags threads where there was sharp disagreement or where no conclusion was reached. Purely social threads — memes, GIF chains, jokes, congratulations — are filtered out so the digest stays signal-heavy.

The output is a Slack-ready roundup the user can skim in under two minutes.

---

## Before you start

Make sure the Slack MCP is connected. If it isn't, tell the user:
> "You'll need the Slack MCP connected to use this skill. Add it to your MCP config, then restart Claude Code."

Claude does not handle Slack tokens directly — the MCP handles authentication. If listing channels or fetching history returns an auth error, surface that error to the user and stop.

---

## Gather context

Before scanning, collect the following. Ask all of these in a single message so the user isn't interrupted mid-task.

**1. Channels to scan** (required)
Ask the user which channels to cover. Accept channel names (e.g. `#team-eng`, `#product`) or IDs. If they say "all the channels I'm in" or similar, default to **public channels only** — do not include DMs or private channels unless the user explicitly opts them in.

> "Which channels should I scan? You can list them by name, or say 'all public channels I'm in'. DMs and private channels are excluded by default — let me know if you want me to include any."

**2. Thread length threshold** (optional)
Default: a thread qualifies if it has **≥ 10 replies** OR **≥ 5 distinct participants**. Offer to override:

> "I'll treat a thread as 'long' if it has 10+ replies or 5+ distinct participants. Want to tighten or loosen that?"

**3. Time window** (optional)
Default: last 7 days. Confirm briefly:

> "Scanning the last 7 days unless you'd prefer a different window."

Do not silently default — say the window back to the user so they can correct it.

---

## How to scan

Use the Slack MCP tools (exact names vary by MCP build — common variants are noted). Cache user-ID → display-name lookups across the run to avoid repeated calls.

1. **List channels** — call the channel-list tool (e.g. `slack_list_channels` / `conversations_list`) and filter to the user's set.
2. **Pull recent history per channel** — for each channel, call the history tool (e.g. `slack_get_channel_history` / `conversations_history`) with `oldest` set to 7 days ago (Unix timestamp).
3. **Identify candidate threads** — keep parent messages where `reply_count >= 10` OR `reply_users_count >= 5` (using the user's threshold if overridden).
4. **Fetch each thread in full** — call the replies tool (e.g. `slack_get_thread_replies` / `conversations_replies`) with the parent `ts`.
5. **Resolve user IDs** — call the user-info tool (e.g. `slack_get_user_profile` / `users_info`) once per unique user, cache the display name.
6. **Get the permalink** for each thread (e.g. `chat_getPermalink`) so the output is verifiable.

If a channel returns `not_in_channel`, `channel_not_found`, or a private-channel error, skip it silently and add 1 to a "skipped channels" counter that surfaces in the output footer.

---

## What counts as "significant"

A thread is significant if it shows substantive back-and-forth on a topic, a decision being made (or attempted), or visible disagreement. Apply the social filter below to drop banter.

### Social filter (exclude these)

Drop a thread if **any two** of the following are true:
- Most replies are < 20 characters (rough rule: median message length < 20 chars)
- High ratio of emoji-only / GIF / image-only replies vs. text content (≥ 50% of replies)
- No question marks anywhere in the thread
- No action verbs from this set in any message: `decide`, `decided`, `should`, `shouldn't`, `can we`, `will`, `agree`, `disagree`, `propose`, `plan`, `ship`, `block`, `blocker`, `risk`, `concern`
- No links to docs, PRs, issues, Notion, Linear, GitHub, or external URLs

When uncertain, **lean toward including**. A user can ignore a borderline entry; missing a real one is worse.

---

## Detecting disagreement

Flag a thread with `🔥 Disagreement` when any of these apply:

- Explicit markers in messages: "I disagree", "I'm not sure that's right", "I'd push back", "actually", "however", "but I think", "concern", "blocker"
- Two or more participants propose distinct, incompatible approaches
- The same two participants go back and forth ≥ 3 turns each
- Negative-leaning reactions (`👎`, `🤔`, `❌`, `⛔`) from multiple distinct users
- Quoted disagreement: someone explicitly quotes or replies-to a prior message with a counter

Use the strongest signal you find as the basis for the flag — don't require all of them.

---

## Detecting no-decision / unresolved

Flag a thread with `❓ Unresolved` when any of these apply:

- The last 2–3 messages end with an open question (trailing `?` and no follow-up answer)
- Phrases like "let's discuss later", "TBD", "needs more thought", "parking this", "follow-up needed", "punt", "circle back", "offline"
- No named owner or action item by the end of the thread
- Last message is > 24h old AND the thread contains **no** agreement language: "sounds good", "let's do that", "agreed", "ship it", "decided", "going with", "let's go", "approved"

A thread can have **both** `🔥` and `❓` flags — that's a strong "needs attention" signal.

---

## Per-thread summary

For each surfaced thread, gather:

- **Channel** name + Slack permalink to the parent message
- **Initiator** — display name of the parent-message author
- **Participants** — top 3–5 by message count, plus a "+N others" tail. Show total participant count and total reply count.
- **Summary** — 1–2 sentences describing what the thread is about and how it progressed. Be specific (what was proposed, what was contested) rather than generic ("they discussed the project").
- **Decisions** — bullet list of what was explicitly agreed. If nothing was clearly decided, write `None reached` — do not invent decisions.
- **Flags** — `🔥 Disagreement`, `❓ Unresolved`, both, or none.
- Optional: 1–2 short verbatim quotes (under ~15 words each), attributed by name, when they capture the controversial point well.

---

## Output format

Produce a Slack-ready summary using this structure:

```
*Important Slack threads — last 7 days*

*#channel-name* — [short thread title or first-line preview] (<permalink|view thread>)
• Initiated by: @person
• Participants: @a, @b, @c, +4 others (8 total, 23 replies)
• Summary: [1–2 sentences — what was discussed and how it went]
• Decisions:
  – [decision 1]
  – [decision 2]
  (or: None reached)
• Flags: 🔥 Disagreement, ❓ Unresolved

*#other-channel* — ...
• ...

_Scanned N channels over the last 7 days. M threads met the length threshold, K surfaced after filtering social/banter. P channels skipped (private or no access)._
```

Rules for the output:

- Use Slack markdown (`*bold*`, `_italic_`, bullets with `•`, sub-bullets with `–`)
- **Sort order**: threads flagged with both `🔥` and `❓` first, then `❓` alone, then `🔥` alone, then by participant count desc, then by reply count desc
- **Cap the output at 10 threads.** If more qualified, note `(N more not shown)` in the footer
- Use Slack `<url|label>` link syntax for permalinks so they render as clickable links in Slack
- Keep each summary tight — if you can't say something specific, the thread probably shouldn't be in the digest

---

## Accuracy and verification rules

- **Always include the permalink.** The user must be able to click through to verify any claim.
- **Never invent decisions.** If no clear agreement was stated, write `None reached`. Do not paraphrase a maybe-decision as a decision.
- **Quote sparingly and accurately.** Verbatim quotes must be exact (within Slack's formatting) and attributed by display name. Don't quote more than ~15 words.
- **Don't surface threads from channels the user didn't include.** If you stumbled into a related channel via cross-posts, leave it out.
- **Skip private/inaccessible channels silently** but count them in the footer so the user knows their coverage.
- **Distinguish observation from inference.** "Three people pushed back on the rollout date" is an observation. "The team is unhappy with the rollout date" is inference — only say it if it's clearly supported by the thread.
- If a thread is borderline-social but contains a real decision or disagreement, keep it and explain briefly in the summary.

---

## Example trigger phrases

- "What were the most important Slack threads this week?"
- "Give me a Slack roundup for the last 7 days"
- "What did I miss on Slack?"
- "What was controversial this week?"
- "Any unresolved threads I should look at?"
- "Summarize the big discussions in #product and #team-eng"
