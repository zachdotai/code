import { useSignalSourceToggles } from "@posthog/ui/features/inbox/hooks/useSignalSourceToggles";
import { useSignalTeamConfig } from "@posthog/ui/features/inbox/hooks/useSignalTeamConfig";
import { useIntegrationSelectors } from "@posthog/ui/features/integrations/store";
import { useRepositoryIntegration } from "@posthog/ui/features/integrations/useIntegrations";
import { create } from "zustand";

export type InboxOnboardingStep = "welcome" | "github" | "slack" | "activate";

export const STEP_ORDER: InboxOnboardingStep[] = [
  "welcome",
  "github",
  "slack",
  "activate",
];

function clampIndex(index: number): number {
  return Math.max(0, Math.min(STEP_ORDER.length - 1, index));
}

interface OnboardingSessionStore {
  /**
   * Cursor into `STEP_ORDER`. Unlike the old derived-step model, the step is
   * now explicit so the user can move backward as well as forward. Session
   * scoped: a fresh session starts at the welcome step.
   */
  stepIndex: number;
  /**
   * Slack skip is session-scoped: if the user finishes onboarding without
   * Slack we just never re-show the takeover, which naturally means no nag.
   * If they abandon mid-flow the skip evaporates on next open.
   */
  slackSkipped: boolean;
  /**
   * Latches whether the takeover is showing this session. Decided once (from
   * `isComplete`) when onboarding first loads, then held so completing the
   * final step doesn't yank the pane out from under the user mid-flow — they
   * leave by clicking "Activate agents" (`finish`).
   */
  active: boolean | null;
  /** Set once the user explicitly finishes on the Activate step. */
  finished: boolean;
  goToStep: (index: number) => void;
  goNext: () => void;
  goBack: () => void;
  skipSlack: () => void;
  setActive: (active: boolean) => void;
  finish: () => void;
  reset: () => void;
}

export const useInboxOnboardingSessionStore = create<OnboardingSessionStore>(
  (set) => ({
    stepIndex: 0,
    slackSkipped: false,
    active: null,
    finished: false,
    goToStep: (index) => set({ stepIndex: clampIndex(index) }),
    goNext: () => set((s) => ({ stepIndex: clampIndex(s.stepIndex + 1) })),
    goBack: () => set((s) => ({ stepIndex: clampIndex(s.stepIndex - 1) })),
    skipSlack: () => set({ slackSkipped: true }),
    setActive: (active) => set({ active }),
    finish: () => set({ finished: true }),
    reset: () =>
      set({
        stepIndex: 0,
        slackSkipped: false,
        active: null,
        finished: false,
      }),
  }),
);

export interface InboxOnboardingStepInfo {
  step: InboxOnboardingStep;
  done: boolean;
}

export interface InboxOnboardingState {
  /** All steps in order, each with its completion flag. Always length 4. */
  steps: InboxOnboardingStepInfo[];
  currentStep: InboxOnboardingStep;
  currentIndex: number;
  /** Whether the current step's requirement is satisfied (gates Continue). */
  currentStepDone: boolean;
  isLastStep: boolean;
  /** Slack is connected and not skipped, so a default channel can be chosen. */
  slackChannelApplicable: boolean;
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
  const stepIndex = useInboxOnboardingSessionStore((s) => s.stepIndex);
  const slackSkipped = useInboxOnboardingSessionStore((s) => s.slackSkipped);

  const githubDone = hasGithubIntegration && repositories.length > 0;
  const slackDone = hasSlackIntegration || slackSkipped;
  const sourcesDone = Object.values(displayValues).some(Boolean);
  const slackChannelApplicable = hasSlackIntegration && !slackSkipped;
  const channelDone =
    !slackChannelApplicable || !!teamConfig?.default_slack_notification_channel;
  // The Activate step bundles source selection and the Slack channel choice.
  const activateDone = sourcesDone && channelDone;

  const doneByStep: Record<InboxOnboardingStep, boolean> = {
    welcome: true,
    github: githubDone,
    slack: slackDone,
    activate: activateDone,
  };

  const currentIndex = clampIndex(stepIndex);
  const currentStep = STEP_ORDER[currentIndex];

  return {
    steps: STEP_ORDER.map((step) => ({ step, done: doneByStep[step] })),
    currentStep,
    currentIndex,
    currentStepDone: doneByStep[currentStep],
    isLastStep: currentIndex === STEP_ORDER.length - 1,
    slackChannelApplicable,
    isComplete: githubDone && slackDone && activateDone,
    isLoading: teamConfigLoading || sourcesLoading,
  };
}

/**
 * Progress across the actionable steps (everything but the informational
 * welcome). Used by the Agents-view callout to nudge "N of M done".
 */
export function inboxOnboardingProgress(state: InboxOnboardingState): {
  doneCount: number;
  totalCount: number;
} {
  const actionable = state.steps.filter((s) => s.step !== "welcome");
  return {
    doneCount: actionable.filter((s) => s.done).length,
    totalCount: actionable.length,
  };
}
