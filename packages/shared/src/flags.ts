export const BILLING_FLAG = "posthog-code-billing";
export const SPEND_ANALYSIS_FLAG = "posthog-code-spend-analysis";
export const EXPERIMENT_SUGGESTIONS_FLAG =
  "posthog-code-experiment-suggestions";
export const SYNC_CLOUD_TASKS_FLAG = "posthog-code-sync-cloud-tasks";
/** Autoresearch (metric-optimization loop). Staff-gated while it bakes. */
export const AUTORESEARCH_FLAG = "posthog-code-autoresearch";
export const HOME_TAB_FLAG = "posthog-code-home-tab";
export const DISCOVERY_RUN_FLAG = "posthog-code-discovery-run";
// Gates the entire canvas feature: the app rail's Channels space, the /website
// routes, channels and dashboards.
export const PROJECT_BLUEBIRD_FLAG = "project-bluebird";
export const TASKS_PREWARM_SANDBOX_FLAG = "tasks-prewarm-sandbox";
export const GLM_MODEL_FLAG = "posthog-code-glm-model";
// Gates tab-owned split panes: dragging a tab pill onto pane/root drop zones
// to merge it into the active tab as a split. Off = no drop zones, no merge.
export const TAB_SPLIT_PANES_FLAG = "posthog-code-tab-split-panes";
