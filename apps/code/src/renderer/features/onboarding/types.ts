export type OnboardingStep =
  | "secret-sudoku"
  | "welcome"
  | "project-select"
  | "invite-code"
  | "github"
  | "install-cli"
  | "signals";

export const ONBOARDING_STEPS: OnboardingStep[] = [
  "secret-sudoku",
  "welcome",
  "project-select",
  "invite-code",
  "github",
  "install-cli",
  "signals",
];
