export const BILLING_FLAG = "posthog-code-billing";
export const INBOX_GATED_DUE_TO_SCALE_FLAG = "inbox-gated-due-to-scale";
export const EXPERIMENT_SUGGESTIONS_FLAG =
  "posthog-code-experiment-suggestions";
export const SYNC_CLOUD_TASKS_FLAG = "posthog-code-sync-cloud-tasks";
// Gates "bring your own key/subscription" (run Claude/Codex against the user's
// own login instead of PostHog's gateway). Targeted to PostHog employees.
export const BRING_YOUR_OWN_KEY_FLAG = "posthog-code-bring-your-own-key";
export const BRANCH_PREFIX = "posthog-code/";
export const DATA_DIR = ".posthog-code";
export const WORKTREES_DIR = ".posthog-code/worktrees";
export const LEGACY_DATA_DIRS = [
  ".twig",
  ".twig/worktrees",
  ".twig/workspaces",
  ".array",
];
