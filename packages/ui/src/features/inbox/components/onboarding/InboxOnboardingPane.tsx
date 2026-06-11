import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  SlackLogoIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { Button, cn } from "@posthog/quill";
import { formatRelativeTimeLong } from "@posthog/shared";
import { InboxWelcomeContent } from "@posthog/ui/features/inbox/components/onboarding/InboxOnboardingWelcome";
import {
  type InboxOnboardingStep,
  type InboxOnboardingStepInfo,
  useInboxOnboardingSessionStore,
  useInboxOnboardingState,
} from "@posthog/ui/features/inbox/components/onboarding/useInboxOnboardingState";
import {
  type Integration,
  useIntegrationSelectors,
} from "@posthog/ui/features/integrations/store";
import { useIntegrations } from "@posthog/ui/features/integrations/useIntegrations";
import { useSlackConnect } from "@posthog/ui/features/integrations/useSlackConnect";
import { GitHubIntegrationSection } from "@posthog/ui/features/settings/sections/GitHubIntegrationSection";
import { SignalDefaultChannelSettings } from "@posthog/ui/features/settings/sections/SignalDefaultChannelSettings";
import { SignalSourcesSettings } from "@posthog/ui/features/settings/sections/SignalSourcesSettings";
import { Flex, Spinner, Text } from "@radix-ui/themes";

const STEP_LABEL: Record<InboxOnboardingStep, string> = {
  welcome: "Welcome",
  github: "GitHub",
  slack: "Slack",
  activate: "Activate",
};

const STEP_META: Record<
  Exclude<InboxOnboardingStep, "welcome">,
  { title: string; subtitle: string }
> = {
  github: {
    title: "Connect GitHub",
    subtitle:
      "Point your agents at the code they'll open pull requests against. Connect your org and pick the repo to target by default.",
  },
  slack: {
    title: "Connect Slack",
    subtitle:
      "Slack is where your agents deliver reports and take requests. Connect your workspace so everything lands where your team already works.",
  },
  activate: {
    title: "Activate agents",
    subtitle:
      "Choose what your agents watch and where reports land. Flip these on and self-driving starts working.",
  },
};

/**
 * Full-screen onboarding takeover shown in place of the inbox tabs until setup
 * is done. A linear-but-navigable stepper: Welcome → GitHub → Slack → Activate.
 * The cursor lives in the session store so the user can move backward as well
 * as forward; Continue is gated on the current step being satisfied.
 */
export function InboxOnboardingPane() {
  const state = useInboxOnboardingState();
  const goNext = useInboxOnboardingSessionStore((s) => s.goNext);
  const goBack = useInboxOnboardingSessionStore((s) => s.goBack);
  const goToStep = useInboxOnboardingSessionStore((s) => s.goToStep);
  const skipSlack = useInboxOnboardingSessionStore((s) => s.skipSlack);
  const finish = useInboxOnboardingSessionStore((s) => s.finish);
  const { slackIntegrations, hasSlackIntegration } = useIntegrationSelectors();
  const slackIntegrationId = slackIntegrations[0]?.id ?? null;

  if (state.isLoading) return null;

  const { currentStep, currentIndex, currentStepDone, isLastStep, steps } =
    state;
  const doneByStep = Object.fromEntries(
    steps.map((s) => [s.step, s.done]),
  ) as Record<InboxOnboardingStep, boolean>;
  const isWelcome = currentStep === "welcome";
  const showSkipSlack = currentStep === "slack" && !hasSlackIntegration;

  const handleSkipSlack = () => {
    skipSlack();
    goNext();
  };
  const handleContinue = () => {
    if (isLastStep) finish();
    else goNext();
  };

  return (
    <div
      className={cn(
        "mx-auto w-full px-6 py-10",
        isWelcome ? "max-w-3xl" : "max-w-2xl",
      )}
    >
      <Flex direction="column" gap="8">
        <Stepper
          steps={steps}
          currentIndex={currentIndex}
          currentStepDone={currentStepDone}
          onSelect={goToStep}
        />

        {isWelcome ? (
          <InboxWelcomeContent />
        ) : (
          <Flex direction="column" gap="6">
            <Flex
              direction="column"
              className="cursor-default select-none gap-2"
            >
              <Text className="font-bold text-[22px] text-gray-12 leading-tight tracking-tight">
                {STEP_META[currentStep].title}
              </Text>
              <Text className="max-w-prose text-[13px] text-gray-11 leading-relaxed">
                {STEP_META[currentStep].subtitle}
              </Text>
            </Flex>

            <div className="rounded-(--radius-3) border border-gray-5 bg-(--color-panel-solid) px-6 py-6">
              {currentStep === "github" && (
                <GitHubIntegrationSection
                  hasGithubIntegration={doneByStep.github}
                  showBottomBorder={false}
                />
              )}
              {currentStep === "slack" && <SlackStepBody />}
              {currentStep === "activate" && (
                <ActivateStepBody
                  slackIntegrationId={slackIntegrationId}
                  slackChannelApplicable={state.slackChannelApplicable}
                />
              )}
            </div>
          </Flex>
        )}

        <Flex align="center" justify="between" className="pt-1">
          <div>
            {currentIndex > 0 && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={goBack}
                className="gap-1.5"
              >
                <ArrowLeftIcon size={14} weight="bold" />
                Back
              </Button>
            )}
          </div>
          <Flex align="center" gap="2">
            {showSkipSlack && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={handleSkipSlack}
              >
                I don't use Slack
              </Button>
            )}
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={handleContinue}
              disabled={!currentStepDone}
              className="gap-1.5"
            >
              {isLastStep ? "Activate agents" : "Continue"}
              {!isLastStep && <ArrowRightIcon size={14} weight="bold" />}
            </Button>
          </Flex>
        </Flex>
      </Flex>
    </div>
  );
}

function Stepper({
  steps,
  currentIndex,
  currentStepDone,
  onSelect,
}: {
  steps: InboxOnboardingStepInfo[];
  currentIndex: number;
  currentStepDone: boolean;
  onSelect: (index: number) => void;
}) {
  return (
    <Flex
      align="center"
      className="cursor-default select-none gap-0 text-[12px]"
    >
      {steps.map((info, idx) => {
        const isCurrent = idx === currentIndex;
        // Back to anything already visited; forward only one step, once the
        // current step is satisfied.
        const reachable =
          idx <= currentIndex || (idx === currentIndex + 1 && currentStepDone);
        return (
          <Flex key={info.step} align="center" className="min-w-0 gap-0">
            {idx > 0 && (
              <span
                className={`mx-2 h-px w-6 ${
                  idx <= currentIndex ? "bg-(--gray-7)" : "bg-(--gray-5)"
                }`}
                aria-hidden
              />
            )}
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onSelect(idx)}
              className={cn(
                "flex items-center gap-2 rounded-(--radius-2) px-1 py-0.5",
                reachable ? "cursor-pointer" : "cursor-default",
              )}
            >
              <StepBadge
                index={idx + 1}
                isCurrent={isCurrent}
                isDone={info.done}
              />
              <Text
                className={
                  isCurrent
                    ? "font-semibold text-gray-12"
                    : info.done
                      ? "text-gray-11"
                      : "text-gray-10"
                }
              >
                {STEP_LABEL[info.step]}
              </Text>
            </button>
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
  if (isCurrent) {
    return (
      <span
        className={`${base} bg-(--gray-12) text-gray-1`}
        aria-current="step"
      >
        {index}
      </span>
    );
  }
  if (isDone) {
    return (
      <span className={`${base} bg-(--green-9) text-white`} aria-hidden>
        <CheckIcon size={11} weight="bold" />
      </span>
    );
  }
  return (
    <span
      className={`${base} bg-(--gray-3) text-gray-10 ring-(--gray-5) ring-1 ring-inset`}
      aria-hidden
    >
      {index}
    </span>
  );
}

/**
 * Activate step: pick the signal sources the agents watch and, when Slack is
 * connected, the default channel reports post to. Toggling these is what makes
 * the step "done" and lights up the Activate button.
 */
function ActivateStepBody({
  slackIntegrationId,
  slackChannelApplicable,
}: {
  slackIntegrationId: number | null;
  slackChannelApplicable: boolean;
}) {
  return (
    <Flex direction="column" gap="5">
      <SignalSourcesSettings showSlackNotifications={false} />
      {slackChannelApplicable && (
        <div className="border-gray-4 border-t pt-5">
          <SignalDefaultChannelSettings integrationId={slackIntegrationId} />
        </div>
      )}
    </Flex>
  );
}

/**
 * Onboarding-shaped Slack widget: just the connect handshake and the connected
 * state. The "I don't use Slack" escape lives in the pane footer, and the
 * notification channel choice belongs to the Activate step.
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
      <Flex direction="column" className="min-w-0 flex-1 gap-0.5">
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
      className="cursor-default select-none gap-0.5 border-gray-5 border-b px-6 pt-5 pb-5"
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
