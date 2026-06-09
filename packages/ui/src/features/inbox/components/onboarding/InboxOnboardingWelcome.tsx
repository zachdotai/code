import { ArrowRightIcon } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { explorerHog } from "@posthog/ui/assets/hedgehogs";
import { ConventionalCommitScopeTag } from "@posthog/ui/features/inbox/components/ConventionalCommitScopeTag";
import { useInboxOnboardingSessionStore } from "@posthog/ui/features/inbox/components/onboarding/useInboxOnboardingState";
import { PriorityMonogram } from "@posthog/ui/features/inbox/components/PriorityMonogram";
import { ForYouBadge } from "@posthog/ui/features/inbox/components/utils/ForYouBadge";
import { InboxBadge } from "@posthog/ui/features/inbox/components/utils/InboxBadge";
import { OnboardingHogTip } from "@posthog/ui/primitives/OnboardingHogTip";
import { Flex, Text } from "@radix-ui/themes";
import { motion } from "framer-motion";

/**
 * Welcome scene shown once per session before the setup stepper. Sells
 * self-driving as the product: agents ship pull requests, deliver them
 * to your Slack, and respond when you ask them directly.
 */
export function InboxOnboardingWelcome() {
  const acknowledgeWelcome = useInboxOnboardingSessionStore(
    (s) => s.acknowledgeWelcome,
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <Flex direction="column" gap="9">
        <Hero />

        <Flex direction="column" gap="7">
          <Beat
            index={1}
            label="Pull requests, ready to review."
            description="Your agents read your product data and open PRs against your repo for the work that's safe to autostart – diff, tests, the right reviewers, the lot."
            preview={<PullRequestCardPreview />}
            delay={0.05}
          />
          <Beat
            index={2}
            label="Delivered straight to Slack."
            description="Every PR your agents ship drops into the Slack channel you pick. Skim the diff, hit Review, never miss a release."
            preview={<SlackPrNotificationPreview />}
            delay={0.1}
          />
          <Beat
            index={3}
            label="Or just ask @PostHog."
            description="Need a one-off? Mention @PostHog in any channel. We'll kick off the work and tag you back when it's ready."
            preview={<SlackMentionPreview />}
            delay={0.15}
          />
        </Flex>

        <Flex direction="column" align="start" gap="4">
          <OnboardingHogTip
            hogSrc={explorerHog}
            message="Let's get you set up – two minutes, then we'll get to work."
          />
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={acknowledgeWelcome}
            className="gap-2"
          >
            Set it up
            <ArrowRightIcon size={14} weight="bold" />
          </Button>
          <Text className="cursor-default select-none text-[11px] text-gray-10 uppercase tracking-[0.04em]">
            About two minutes · Slack, GitHub, sources, notifications
          </Text>
        </Flex>
      </Flex>
    </div>
  );
}

function Hero() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <Flex direction="column" gap="3" className="cursor-default select-none">
        <Text className="text-[11px] text-gray-10 uppercase tracking-[0.08em]">
          Welcome to PostHog Code
        </Text>
        <Text className="font-bold text-[34px] text-gray-12 leading-[1.05] tracking-[-0.02em]">
          Self-driving for your product.
        </Text>
        <Text className="max-w-prose text-[14px] text-gray-11 leading-relaxed">
          Your agents read your product data and ship pull requests against your
          code. They drop the PRs into Slack so you don't have to context-switch
          – and you can talk to them like a teammate.
        </Text>
      </Flex>
    </motion.div>
  );
}

function Beat({
  index,
  label,
  description,
  preview,
  delay,
}: {
  index: number;
  label: string;
  description: string;
  preview: React.ReactNode;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
    >
      <Flex direction="column" gap="3">
        <Flex align="baseline" gap="3" className="cursor-default select-none">
          <Text className="font-mono text-[11px] text-gray-9 tabular-nums">
            0{index}
          </Text>
          <Flex direction="column" gap="0.5" className="min-w-0 flex-1">
            <Text className="font-semibold text-[15px] text-gray-12 leading-snug">
              {label}
            </Text>
            <Text className="max-w-prose text-[12.5px] text-gray-11 leading-snug">
              {description}
            </Text>
          </Flex>
        </Flex>
        <div className="pl-8">{preview}</div>
      </Flex>
    </motion.div>
  );
}

// ── Preview clones ───────────────────────────────────────────────────────
//
// Visual stand-ins for the real surfaces (PullRequestCard, Slack chrome).
// The PR card reuses production primitives directly so it reads pixel-
// close to what users will see post-setup. The Slack previews mirror
// Slack's chrome closely enough that the demo doesn't read as stylised.

function PullRequestCardPreview() {
  return (
    <div className="flex w-full items-stretch gap-3 rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-4 py-3.5">
      <Flex align="start" gap="3" className="min-w-0 flex-1">
        <PriorityMonogram priority="P1" />
        <Flex direction="column" gap="1.5" className="min-w-0 flex-1">
          <Flex align="center" gap="1" wrap="wrap" className="min-w-0">
            <ConventionalCommitScopeTag type="fix" scope="capture" compact />
            <Text className="wrap-break-word min-w-0 font-semibold text-[13.5px] text-gray-12 leading-snug">
              Stop sending duplicate $pageview events on SPA history push
            </Text>
          </Flex>
          <Text className="wrap-break-word line-clamp-2 text-[12.5px] text-gray-10 leading-snug">
            5.4% of $pageview events were duplicates — inflated funnels and
            ~$1.2k/month over-billing across 2,317 customers.
          </Text>
          <Flex align="center" gap="2.5" wrap="wrap" className="mt-1.5">
            <Text className="cursor-default select-none text-[11px] text-gray-11">
              posthog/posthog
            </Text>
            <Flex
              align="center"
              gap="1.5"
              className="cursor-default select-none font-mono text-[11px] tabular-nums"
            >
              <span className="font-medium text-(--green-11)">+12</span>
              <span className="font-medium text-(--red-11)">−3</span>
            </Flex>
            <InboxBadge variant="success">Actionable</InboxBadge>
            <ForYouBadge />
          </Flex>
        </Flex>
      </Flex>
      <Flex
        align="center"
        gap="2"
        className="shrink-0 self-center border-border border-l pl-3"
      >
        <Button type="button" variant="primary" size="sm">
          Review
        </Button>
      </Flex>
    </div>
  );
}

// ── Slack previews ───────────────────────────────────────────────────────

function SlackPrNotificationPreview() {
  return (
    <SlackChrome channel="releases">
      <SlackMessage
        authorName="PostHog"
        avatarSrc="posthog"
        authorBadge="APP"
        timestamp="10:42 AM"
      >
        <Text className="text-[13.5px] text-gray-12 leading-relaxed">
          I just shipped a draft PR for review:
        </Text>
        <SlackAttachment />
      </SlackMessage>
    </SlackChrome>
  );
}

function SlackMentionPreview() {
  return (
    <SlackChrome channel="engineering">
      <Flex direction="column" gap="3.5">
        <SlackMessage
          authorName="Alice Chen"
          avatarSrc="alice"
          timestamp="10:41 AM"
        >
          <Text className="text-[13.5px] text-gray-12 leading-relaxed">
            <SlackMention name="PostHog" /> can you look into the dashboard
            latency complaints? Something regressed in the last week.
          </Text>
        </SlackMessage>
        <SlackMessage
          authorName="PostHog"
          avatarSrc="posthog"
          authorBadge="APP"
          timestamp="10:42 AM"
        >
          <Text className="text-[13.5px] text-gray-12 leading-relaxed">
            On it. Pulling the last 7 days of session replays and error tracking
            for the dashboard route – I'll tag you when I have something.
          </Text>
        </SlackMessage>
      </Flex>
    </SlackChrome>
  );
}

function SlackChrome({
  channel,
  children,
}: {
  channel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-(--radius-3) border border-gray-5 bg-(--color-panel-solid)">
      <Flex
        align="center"
        gap="1.5"
        className="cursor-default select-none border-gray-4 border-b px-4 py-2.5"
      >
        <span className="font-mono text-[14px] text-gray-10">#</span>
        <Text className="font-bold text-[13.5px] text-gray-12">{channel}</Text>
      </Flex>
      <div className="px-4 py-3.5">{children}</div>
    </div>
  );
}

function SlackMessage({
  authorName,
  avatarSrc,
  authorBadge,
  timestamp,
  children,
}: {
  authorName: string;
  avatarSrc: "alice" | "posthog";
  authorBadge?: string;
  timestamp: string;
  children: React.ReactNode;
}) {
  return (
    <Flex align="start" gap="2.5">
      <SlackAvatar variant={avatarSrc} />
      <Flex direction="column" gap="0.5" className="min-w-0 flex-1">
        <Flex align="baseline" gap="1.5" className="cursor-default select-none">
          <Text className="font-bold text-[13.5px] text-gray-12 leading-none">
            {authorName}
          </Text>
          {authorBadge && (
            <span className="rounded-sm bg-(--gray-4 px-1 py-px font-bold text-[9px] text-gray-11 uppercase tracking-wider">
              {authorBadge}
            </span>
          )}
          <Text className="text-[11px] text-gray-10 leading-none">
            {timestamp}
          </Text>
        </Flex>
        <div>{children}</div>
      </Flex>
    </Flex>
  );
}

function SlackAvatar({ variant }: { variant: "alice" | "posthog" }) {
  if (variant === "posthog") {
    return (
      <span
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-(--accent-9) font-bold text-[15px] text-white"
        aria-hidden
      >
        🦔
      </span>
    );
  }
  return (
    <span
      className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#e8912d] font-bold text-[13px] text-white"
      aria-hidden
    >
      A
    </span>
  );
}

function SlackMention({ name }: { name: string }) {
  return (
    <span className="rounded-sm bg-(--blue-3) px-1 py-px font-medium text-(--blue-11)">
      @{name}
    </span>
  );
}

function SlackAttachment() {
  return (
    <div className="mt-1.5 flex overflow-hidden rounded-(--radius-2) border border-gray-5 bg-(--color-panel-solid)">
      <div className="w-1 shrink-0 bg-(--accent-9)" aria-hidden />
      <Flex direction="column" gap="1" className="min-w-0 flex-1 px-3 py-2.5">
        <Text className="cursor-default select-none font-mono text-[11px] text-gray-10">
          posthog/posthog#12345
        </Text>
        <Text className="font-semibold text-[13px] text-gray-12 leading-snug">
          Stop sending duplicate $pageview events on SPA history push
        </Text>
        <Flex align="center" gap="2" className="mt-0.5">
          <Flex
            align="center"
            gap="1.5"
            className="cursor-default select-none font-mono text-[11px] tabular-nums"
          >
            <span className="font-medium text-(--green-11)">+12</span>
            <span className="font-medium text-(--red-11)">−3</span>
          </Flex>
          <Text className="text-[11px] text-gray-10">·</Text>
          <Text className="font-medium text-(--blue-11) text-[12px]">
            Review on GitHub
          </Text>
        </Flex>
      </Flex>
    </div>
  );
}
