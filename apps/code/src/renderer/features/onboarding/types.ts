export type OnboardingStep =
  | "welcome"
  | "claude-auth-method"
  | "project-select"
  | "invite-code"
  | "github"
  | "install-cli";

export const ONBOARDING_STEPS: OnboardingStep[] = [
  "welcome",
  "claude-auth-method",
  "project-select",
  "invite-code",
  "github",
  "install-cli",
];
