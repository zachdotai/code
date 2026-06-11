import {
  SlackAskPostHogPreview,
  SlackMention,
  SlackReportNotificationPreview,
} from "@posthog/ui/features/inbox/components/onboarding/FakeSlack";
import { PrDiffIndicator } from "@posthog/ui/features/inbox/components/PrDiffIndicator";
import { PullRequestCardView } from "@posthog/ui/features/inbox/components/PullRequestCardView";
import { Flex, Text } from "@radix-ui/themes";
import { motion } from "framer-motion";

/**
 * The welcome scene — now the first onboarding step. Sells self-driving as the
 * product (agents ship pull requests, deliver them to Slack, respond when
 * asked). The surrounding pane owns the stepper chrome and Back/Continue, so
 * this renders content only.
 */
export function InboxWelcomeContent() {
  return (
    <Flex direction="column" gap="7">
      <Hero />

      <Flex direction="column" gap="7">
        <Beat
          index={1}
          label="Pull requests, ready to merge."
          description="Your agents read your product data and open PRs against your repo for the work that's safe to autostart – diff, tests, the right reviewers, the lot."
          preview={<PullRequestCardPreview />}
          delay={0.05}
        />
        <Beat
          index={2}
          label="Delivered straight to Slack."
          description="Every report lands in a dedicated #posthog-inbox channel – not your existing channels, so nothing gets spammed. Skim the diff, hit Review, and the right people are tagged automatically."
          preview={<SlackReportNotificationPreview />}
          delay={0.1}
        />
        <Beat
          index={3}
          label="Or just ask @PostHog."
          description="Need a one-off? Mention @PostHog in any channel. We'll dig through your analytics, errors, replays, and code, then offer to ship the fix."
          preview={<SlackAskPostHogPreview />}
          delay={0.15}
        />
      </Flex>
    </Flex>
  );
}

function Hero() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <Flex direction="column" className="cursor-default select-none gap-2">
        <Text className="font-bold text-[34px] text-gray-12 leading-[1.05] tracking-[-0.02em]">
          Welcome to self-driving for your product
        </Text>
        <Text className="max-w-prose text-[13px] text-gray-11 leading-relaxed">
          PostHog responder agents monitor your users' experience and your
          systems for issues. They hand you the fix as a pull request, dropped
          into Slack so you never context-switch. And you can talk to{" "}
          <SlackMention name="PostHog" /> like a teammate.
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
          <Flex direction="column" className="min-w-0 flex-1 gap-0.5">
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

/**
 * Beat 1 preview: the exact production `PullRequestCardView`, fed mocked data
 * and no handlers, so it reads pixel-identical to the live pull requests list.
 */
function PullRequestCardPreview() {
  return (
    <PullRequestCardView
      priority="P1"
      conventionalTitle={{ type: "fix", scope: "capture" }}
      title="Stop sending duplicate $pageview events on SPA history push"
      headline="5.4% of $pageview events were duplicates — inflated funnels and ~$1.2k/month over-billing across 2,317 customers."
      repoSlug="PostHog/hogflix"
      sourceProducts={["error_tracking"]}
      diffSlot={<PrDiffIndicator added={12} removed={3} files={2} />}
    />
  );
}
