import { cn } from "@posthog/quill";
import slackAppLogo from "@posthog/ui/assets/services/posthog-slack-app.png";
import { playCompletionSound } from "@posthog/ui/utils/sounds";
import { Flex, Text } from "@radix-ui/themes";
import type { ReactNode } from "react";
import { useState } from "react";

/**
 * High-fidelity, non-interactive Slack stand-ins used in the inbox onboarding
 * welcome scene. These mimic Slack's chrome — channel header, message gutter,
 * square avatars, bold name + timestamp, mention pills, and Block Kit-style
 * message bodies — closely enough that the demo reads as the real thing without
 * pulling in any live Slack data. Theme tokens are used so it sits naturally in
 * the app's light or dark surface rather than a hard white Slack panel.
 */

function SlackSurface({
  channel,
  children,
}: {
  channel: string;
  children: ReactNode;
}) {
  return (
    <div className="cursor-default select-none overflow-hidden rounded-(--radius-3) border border-gray-5 bg-(--color-panel-solid) shadow-sm">
      <header className="flex items-center gap-1 border-gray-4 border-b px-4 py-3">
        <span className="font-mono text-[13px] text-gray-9 leading-none">
          #
        </span>
        <span className="font-bold text-[13px] text-gray-12 leading-none">
          {channel}
        </span>
      </header>
      <div className="flex flex-col py-1.5">{children}</div>
    </div>
  );
}

function SlackAvatar({ variant }: { variant: "richard" | "posthog" }) {
  if (variant === "posthog") {
    return (
      <img
        src={slackAppLogo}
        alt=""
        className="h-8 w-8 shrink-0 rounded-(--radius-2)"
        aria-hidden
      />
    );
  }
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-(--radius-2) bg-[#4a7fd6] font-bold text-[13px] text-white leading-none"
      aria-hidden
    >
      R
    </span>
  );
}

function SlackMessageRow({
  author,
  avatar,
  badge,
  timestamp,
  children,
}: {
  author: string;
  avatar: "richard" | "posthog";
  badge?: string;
  timestamp: string;
  children: ReactNode;
}) {
  return (
    <Flex align="start" className="gap-2.5 px-4 py-2.5">
      <SlackAvatar variant={avatar} />
      <Flex direction="column" className="min-w-0 flex-1 gap-1">
        <Flex align="center" className="gap-1.5">
          <Text className="font-bold text-[13px] text-gray-12 leading-none">
            {author}
          </Text>
          {badge && (
            <span className="rounded-(--radius-1) bg-(--gray-4) px-1 py-px font-bold text-[8px] text-gray-11 uppercase leading-none tracking-wide">
              {badge}
            </span>
          )}
          <Text className="text-[10px] text-gray-10 leading-none">
            {timestamp}
          </Text>
        </Flex>
        <div className="text-[13px] text-gray-12 leading-[1.46]">
          {children}
        </div>
      </Flex>
    </Flex>
  );
}

export function SlackMention({ name }: { name: string }) {
  return (
    <span className="rounded-(--radius-1) bg-(--blue-3) px-1 font-medium text-(--blue-11)">
      @{name}
    </span>
  );
}

function SlackButton({
  children,
  primary = false,
  onClick,
}: {
  children: ReactNode;
  primary?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex cursor-pointer items-center rounded-(--radius-2) px-3 py-1.5 font-bold text-[12px] leading-none transition-colors duration-75",
        primary
          ? "bg-(--green-9) text-white hover:bg-(--green-10) active:bg-(--green-11)"
          : "border border-gray-6 bg-(--color-panel-solid) text-gray-12 hover:border-gray-7 hover:bg-(--gray-2) active:bg-(--gray-3)",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Beat 2 preview: the Block Kit report notification PostHog posts to the
 * dedicated `#posthog-inbox` channel. Mirrors the real backend block layout in
 * `slack_inbox_notifications.py`: header → meta line → summary → context line →
 * action buttons.
 */
export function SlackReportNotificationPreview() {
  return (
    <SlackSurface channel="posthog-inbox">
      <SlackMessageRow
        author="PostHog"
        avatar="posthog"
        badge="App"
        timestamp="10:42 AM"
      >
        <Flex direction="column" className="mt-0.5 gap-2.5">
          {/* header block */}
          <Text className="font-bold text-[13.5px] text-gray-12 leading-snug">
            Resume playback from the saved position, not the start
          </Text>
          {/* section block */}
          <Flex direction="column" className="gap-1.5">
            <Text className="font-bold text-[12.5px] text-gray-12">
              ❗ P1 · Session replay · PostHog/hogflix
            </Text>
            <Text className="text-[12.5px] text-gray-11 leading-relaxed">
              8.4% of “Continue watching” resumes restart the title from 0:00 —
              affected sessions run 14% shorter and resume churn is up 3×.
            </Text>
          </Flex>
          {/* context block */}
          <Text className="text-[11px] text-gray-10">
            3 signals&nbsp;&nbsp;·&nbsp;&nbsp;👤 Suggested reviewers:{" "}
            <SlackMention name="Gilfoyle" />
          </Text>
          {/* actions block */}
          <Flex align="center" gap="2" className="mt-0.5">
            <SlackButton primary onClick={() => playCompletionSound("meep")}>
              Review PR
            </SlackButton>
            <SlackButton onClick={() => playCompletionSound("meep-smol")}>
              Open in PostHog Code
            </SlackButton>
          </Flex>
        </Flex>
      </SlackMessageRow>
    </SlackSurface>
  );
}

// The answer keeps the first sentence and the value-punch question, collapsing
// the analysis in between behind an inline "[…]" toggle — enough to tease the
// depth without dumping a wall of text into the preview.
const ANSWER_FIRST =
  "found it — dashboard p75 load time jumped from 0.8s to 3.2s last Tuesday, right when we shipped PostHog/hogflix#4821 (“cache homepage rows per-user”).";

const ANSWER_MIDDLE =
  "Session replays show the rows skeleton hanging 3–4s on first paint for ~22% of views, and Error tracking has a matching spike in HomeRowsTimeout. The cause is the new per-user cache key — it dropped the shared-row hit rate from 91% to 12%, so nearly every visit recomputes the homepage. I traced it to getHomeRowsCacheKey() in src/server/cache.ts, where #4821 appends the viewer's user id to every key. The fix keeps the shared key and only scopes the user id to the “Because you watched” row; tested against the last week, p75 drops back to ~0.85s.";

const ANSWER_LAST = "Do you want me to ship this fix as a pull request?";

/**
 * Beat 3 preview: a teammate asks PostHog a one-off in a normal channel, and
 * PostHog answers — grounded in analytics, error tracking, replay, and the
 * codebase — then offers to ship the fix. The analysis collapses behind an
 * inline "[…]" toggle, ending on the value punch: a PR on request.
 */
export function SlackAskPostHogPreview() {
  const [expanded, setExpanded] = useState(false);

  return (
    <SlackSurface channel="engineering">
      <SlackMessageRow
        author="Richard Hendricks"
        avatar="richard"
        timestamp="10:41 AM"
      >
        <SlackMention name="PostHog" /> can you look into the dashboard latency
        complaints? Something regressed in the last week.
      </SlackMessageRow>
      <SlackMessageRow
        author="PostHog"
        avatar="posthog"
        badge="App"
        timestamp="10:42 AM"
      >
        <SlackMention name="Richard Hendricks" /> {ANSWER_FIRST}{" "}
        <button
          type="button"
          onClick={() => {
            if (!expanded) playCompletionSound("meep-smol");
            setExpanded((e) => !e);
          }}
          className="cursor-pointer font-medium text-(--blue-11) underline-offset-2 hover:underline"
        >
          […]
        </button>{" "}
        {expanded && <>{ANSWER_MIDDLE} </>}
        <span className="mt-1.5 block">{ANSWER_LAST}</span>
      </SlackMessageRow>
    </SlackSurface>
  );
}
