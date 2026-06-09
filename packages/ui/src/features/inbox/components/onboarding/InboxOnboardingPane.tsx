import { CheckIcon, SlackLogoIcon, WarningIcon } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { formatRelativeTimeLong } from "@posthog/shared";
import {
  builderHog,
  explorerHog as detectiveHog,
  happyHog,
} from "@posthog/ui/assets/hedgehogs";
import mailHog from "@posthog/ui/assets/images/mail-hog.png";
import {
  type InboxOnboardingStep,
  inboxOnboardingProgress,
  useInboxOnboardingSessionStore,
  useInboxOnboardingState,
} from "@posthog/ui/features/inbox/components/onboarding/useInboxOnboardingState";
import {
  type Integration,
  useIntegrationSelectors,
} from "@posthog/ui/features/integrations/store";
import { useSlackConnect } from "@posthog/ui/features/integrations/useSlackConnect";
import { GitHubIntegrationSection } from "@posthog/ui/features/settings/components/sections/GitHubIntegrationSection";
import { SignalDefaultChannelSettings } from "@posthog/ui/features/settings/components/sections/SignalDefaultChannelSettings";
import { SignalSourcesSettings } from "@posthog/ui/features/settings/components/sections/SignalSourcesSettings";
import { useIntegrations } from "@posthog/ui/hooks/useIntegrations";
import { OnboardingHogTip } from "@posthog/ui/primitives/OnboardingHogTip";
import { Flex, Spinner, Text } from "@radix-ui/themes";

const STEP_META: Record<
  InboxOnboardingStep,
  { title: string; subtitle: string }
> = {
  slack: {
    title: "Connect Slack",
    subtitle:
      "Slack is the fastest way to use your agents – kick off tasks by mentioning @PostHog, ask questions in any channel, and have inbox events land where your team already works.",
  },
  github: {
    title: "Connect GitHub",
    subtitle:
      "Research needs source to chase. Connect the GitHub org and pick the repo your agents should open pull requests against by default.",
  },
  sources: {
    title: "Pick signal sources",
    subtitle:
      "What should your agents watch? Error tracking, session replays, support tickets, GitHub issues – anything you turn on becomes input for the inbox.",
  },
  notifications: {
    title: "Pick a notification channel",
    subtitle:
      "Where should inbox events land in Slack? Pick a default channel; you can change this any time.",
  },
};

const STEP_LABEL: Record<InboxOnboardingStep, string> = {
  slack: "Slack",
  github: "GitHub",
  sources: "Sources",
  notifications: "Notifications",
};

const STEP_HOG: Record<InboxOnboardingStep, { src: string; tip: string }> = {
  slack: {
    src: happyHog,
    tip: "Slack's where I'm most useful – mention me anywhere and I'll get to work.",
  },
  github: {
    src: builderHog,
    tip: "Show me where the code lives and I'll start opening pull requests.",
  },
  sources: {
    src: detectiveHog,
    tip: "Tell me what to investigate, I'll dig through the rest.",
  },
  notifications: {
    src: mailHog,
    tip: "Pick a channel and I'll start dropping reports there.",
  },
};

/**
 * Full-screen takeover shown in place of the inbox tabs until setup is done.
 * Strictly linear: each step gates the next, with Slack offering a session
 * skip for genuine non-Slack users.
 */
export function InboxOnboardingPane() {
  const state = useInboxOnboardingState();
  const skipSlack = useInboxOnboardingSessionStore((s) => s.skipSlack);
  const { slackIntegrations } = useIntegrationSelectors();
  const slackIntegrationId = slackIntegrations[0]?.id;

  if (state.isLoading || state.currentStep === null) return null;

  const currentStep = state.currentStep;
  const meta = STEP_META[currentStep];
  const hog = STEP_HOG[currentStep];
  const progress = inboxOnboardingProgress(state);
  const stepNumber = progress.doneCount + 1;

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <Flex direction="column" gap="6">
        <Stepper currentStep={currentStep} state={state} />

        <Flex direction="column" gap="2" className="cursor-default select-none">
          <Text className="text-[11px] text-gray-10 uppercase tracking-[0.08em]">
            Step {stepNumber} of {progress.totalCount} · Self-driving setup
          </Text>
          <Text className="font-bold text-[22px] text-gray-12 leading-tight tracking-tight">
            {meta.title}
          </Text>
          <Text className="max-w-prose text-[13px] text-gray-11 leading-relaxed">
            {meta.subtitle}
          </Text>
        </Flex>

        <div className="rounded-(--radius-3) border border-gray-5 bg-(--color-panel-solid) px-6 py-6">
          {currentStep === "slack" && <SlackStepBody />}
          {currentStep === "github" && (
            <GitHubIntegrationSection
              hasGithubIntegration={state.github.done}
              showBottomBorder={false}
            />
          )}
          {currentStep === "sources" && (
            <SignalSourcesSettings showSlackNotifications={false} />
          )}
          {currentStep === "notifications" && (
            <SignalDefaultChannelSettings integrationId={slackIntegrationId} />
          )}
        </div>

        <OnboardingHogTip
          key={currentStep}
          hogSrc={hog.src}
          message={hog.tip}
        />

        {currentStep === "slack" && (
          <button
            type="button"
            onClick={skipSlack}
            className="cursor-default self-start text-[12px] text-gray-10 underline-offset-2 hover:text-gray-12 hover:underline"
          >
            I don't use Slack – skip for now
          </button>
        )}
      </Flex>
    </div>
  );
}

function Stepper({
  currentStep,
  state,
}: {
  currentStep: InboxOnboardingStep;
  state: ReturnType<typeof useInboxOnboardingState>;
}) {
  const stepDone: Record<InboxOnboardingStep, boolean> = {
    slack: state.slack.done,
    github: state.github.done,
    sources: state.sources.done,
    notifications: state.notifications.done,
  };
  const visibleSteps: InboxOnboardingStep[] = ["slack", "github", "sources"];
  if (state.notifications.applicable) visibleSteps.push("notifications");

  return (
    <Flex
      align="center"
      gap="0"
      className="cursor-default select-none text-[12px]"
    >
      {visibleSteps.map((step, idx) => {
        const isCurrent = step === currentStep;
        const isDone = stepDone[step];
        return (
          <Flex key={step} align="center" gap="0" className="min-w-0">
            {idx > 0 && (
              <span
                className={`mx-2 h-px w-6 ${
                  isDone || isCurrent ? "bg-(--gray-7" : "bg-(--gray-5"
                }`}
                aria-hidden
              />
            )}
            <Flex align="center" gap="2">
              <StepBadge
                index={idx + 1}
                isCurrent={isCurrent}
                isDone={isDone}
              />
              <Text
                className={
                  isCurrent
                    ? "font-semibold text-gray-12"
                    : isDone
                      ? "text-gray-11"
                      : "text-gray-10"
                }
              >
                {STEP_LABEL[step]}
              </Text>
            </Flex>
          </Flex>
        );
      })}
    </Flex>
  );
}

function StepBadge({
  index,
  isCurrent,
  isDone,
}: {
  index: number;
  isCurrent: boolean;
  isDone: boolean;
}) {
  const base =
    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold";
  if (isDone) {
    return (
      <span className={`${base} bg-(--green-9) text-white`} aria-hidden>
        <CheckIcon size={11} weight="bold" />
      </span>
    );
  }
  if (isCurrent) {
    return (
      <span className={`${base} bg-(--gray-12 text-gray-1`} aria-current="step">
        {index}
      </span>
    );
  }
  return (
    <span
      className={`${base} bg-(--gray-3 text-gray-10 ring-(--gray-5 ring-1 ring-inset`}
      aria-hidden
    >
      {index}
    </span>
  );
}

/**
 * Onboarding-shaped Slack widget: just the connect handshake and the
 * connected state. Notification channel choice belongs to the dedicated
 * notifications step, so we deliberately don't pull in
 * `SlackInboxNotificationsSettings` here.
 */
function SlackStepBody() {
  const { isLoading } = useIntegrations();
  const { slackIntegrations, hasSlackIntegration } = useIntegrationSelectors();
  const { connect, isConnecting, isTimedOut, hasError, error } =
    useSlackConnect();

  if (isLoading) {
    return (
      <Flex align="center" gap="2">
        <Spinner size="1" />
        <Text className="text-[13px] text-gray-11">Loading…</Text>
      </Flex>
    );
  }

  if (hasSlackIntegration) {
    return <SlackConnectedRow integration={slackIntegrations[0]} />;
  }

  return (
    <Flex direction="column" gap="3">
      <Button
        type="button"
        variant="primary"
        onClick={() => void connect()}
        disabled={isConnecting}
        className="gap-2 self-start"
      >
        {isConnecting ? <Spinner size="1" /> : <SlackLogoIcon size={14} />}
        {isConnecting ? "Waiting for Slack…" : "Connect Slack workspace"}
      </Button>
      {isTimedOut && (
        <Flex align="center" gap="2" className="text-[12px] text-gray-11">
          <WarningIcon size={12} className="text-(--amber-11)" />
          <span>Didn't hear back from Slack. Try again.</span>
        </Flex>
      )}
      {hasError && error && (
        <Flex align="center" gap="2" className="text-(--red-11) text-[12px]">
          <WarningIcon size={12} />
          <span>{error.message}</span>
        </Flex>
      )}
    </Flex>
  );
}

function SlackConnectedRow({ integration }: { integration: Integration }) {
  const rawDisplayName = integration.display_name;
  const workspaceName =
    (typeof rawDisplayName === "string" && rawDisplayName.trim()) ||
    "Slack workspace";
  const createdAt =
    typeof integration.created_at === "string" ? integration.created_at : null;

  return (
    <Flex align="center" gap="3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--green-2) ring-(--green-5) ring-1 ring-inset">
        <SlackLogoIcon size={18} className="text-(--green-11)" />
      </span>
      <Flex direction="column" gap="0.5" className="min-w-0 flex-1">
        <Text className="font-medium text-[13px] text-gray-12">
          Connected to {workspaceName}
        </Text>
        {createdAt && (
          <Text className="text-[12px] text-gray-10">
            Linked {formatRelativeTimeLong(createdAt)}
          </Text>
        )}
      </Flex>
    </Flex>
  );
}

/**
 * Header rendered above the takeover pane so the Inbox view chrome still
 * reads as "this is the inbox" even while it's gated. Matches the regular
 * `InboxPageHeader` / Agents header shape so the surface stays unified.
 */
export function InboxOnboardingHeader() {
  return (
    <Flex
      direction="column"
      gap="0.5"
      className="cursor-default select-none border-gray-5 border-b px-6 pt-5 pb-5"
    >
      <Text className="font-bold text-[22px] text-gray-12 leading-tight tracking-tight">
        Inbox
      </Text>
      <Text className="max-w-3xl text-[12.5px] text-gray-11 leading-snug">
        A few connections, then your agents start shipping pull requests,
        reports, and live runs here.
      </Text>
    </Flex>
  );
}
