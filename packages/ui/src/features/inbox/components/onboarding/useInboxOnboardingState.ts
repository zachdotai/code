import { useSignalSourceToggles } from "@posthog/ui/features/inbox/hooks/useSignalSourceToggles";
import { useSignalTeamConfig } from "@posthog/ui/features/inbox/hooks/useSignalTeamConfig";
import { useIntegrationSelectors } from "@posthog/ui/features/integrations/store";
import { useRepositoryIntegration } from "@posthog/ui/hooks/useIntegrations";
import { create } from "zustand";

export type InboxOnboardingStep =
  | "slack"
  | "github"
  | "sources"
  | "notifications";

const STEP_ORDER: InboxOnboardingStep[] = [
  "slack",
  "github",
  "sources",
  "notifications",
];

interface OnboardingSessionStore {
  /**
   * Slack skip is session-scoped: if the user finishes onboarding without
   * Slack we just never re-show the takeover, which naturally means no nag.
   * If they abandon mid-flow the skip evaporates on next open.
   */
  slackSkipped: boolean;
  /**
   * The welcome scene appears once per session before the stepper starts.
   * Acknowledging it via "Set it up" drops the user straight into the
   * first incomplete step on subsequent renders.
   */
  welcomeAcknowledged: boolean;
  skipSlack: () => void;
  acknowledgeWelcome: () => void;
  reset: () => void;
}

export const useInboxOnboardingSessionStore = create<OnboardingSessionStore>(
  (set) => ({
    slackSkipped: false,
    welcomeAcknowledged: false,
    skipSlack: () => set({ slackSkipped: true }),
    acknowledgeWelcome: () => set({ welcomeAcknowledged: true }),
    reset: () => set({ slackSkipped: false, welcomeAcknowledged: false }),
  }),
);

export interface InboxOnboardingState {
  slack: { done: boolean; skipped: boolean };
  github: { done: boolean };
  sources: { done: boolean };
  notifications: { done: boolean; applicable: boolean };
  currentStep: InboxOnboardingStep | null;
  isComplete: boolean;
  isLoading: boolean;
}

export function useInboxOnboardingState(): InboxOnboardingState {
  const { hasSlackIntegration } = useIntegrationSelectors();
  // `useRepositoryIntegration` is the same signal the Agents view uses to
  // surface "Connected and active (N repos)" — gating on this keeps the
  // onboarding consistent with what the user sees over there.
  const { hasGithubIntegration, repositories } = useRepositoryIntegration();
  const { data: teamConfig, isLoading: teamConfigLoading } =
    useSignalTeamConfig();
  const { displayValues, isLoading: sourcesLoading } = useSignalSourceToggles();
  const slackSkipped = useInboxOnboardingSessionStore((s) => s.slackSkipped);

  const slackDone = hasSlackIntegration || slackSkipped;
  const githubDone = hasGithubIntegration && repositories.length > 0;
  const sourcesDone = Object.values(displayValues).some(Boolean);
  const notificationsApplicable = hasSlackIntegration && !slackSkipped;
  const notificationsDone =
    !notificationsApplicable ||
    !!teamConfig?.default_slack_notification_channel;

  const isLoading = teamConfigLoading || sourcesLoading;
  const isComplete =
    slackDone && githubDone && sourcesDone && notificationsDone;

  let currentStep: InboxOnboardingStep | null = null;
  if (!isComplete) {
    const stepDone: Record<InboxOnboardingStep, boolean> = {
      slack: slackDone,
      github: githubDone,
      sources: sourcesDone,
      notifications: notificationsDone,
    };
    currentStep =
      STEP_ORDER.find(
        (step) => !stepDone[step] && stepApplies(step, slackSkipped),
      ) ?? null;
  }

  return {
    slack: { done: slackDone, skipped: slackSkipped },
    github: { done: githubDone },
    sources: { done: sourcesDone },
    notifications: {
      done: notificationsDone,
      applicable: notificationsApplicable,
    },
    currentStep,
    isComplete,
    isLoading,
  };
}

function stepApplies(
  step: InboxOnboardingStep,
  slackSkipped: boolean,
): boolean {
  if (step === "notifications") return !slackSkipped;
  return true;
}

export function inboxOnboardingProgress(state: InboxOnboardingState): {
  doneCount: number;
  totalCount: number;
} {
  const steps = [state.slack.done, state.github.done, state.sources.done];
  if (state.notifications.applicable) steps.push(state.notifications.done);
  return {
    doneCount: steps.filter(Boolean).length,
    totalCount: steps.length,
  };
}
