export type OnboardingStep =
  | "welcome"
  | "agent-auth-method"
  | "project-select"
  | "invite-code"
  | "connect-github"
  | "install-cli"
  | "select-repo";

export const ONBOARDING_STEPS: OnboardingStep[] = [
  "welcome",
  "agent-auth-method",
  "project-select",
  "invite-code",
  "connect-github",
  "install-cli",
  "select-repo",
];
