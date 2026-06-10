export const DATABASE_SERVICE = Symbol.for("posthog.workspace.databaseService");

export const REPOSITORY_REPOSITORY = Symbol.for(
  "posthog.workspace.repositoryRepository",
);
export const WORKSPACE_REPOSITORY = Symbol.for(
  "posthog.workspace.workspaceRepository",
);
export const WORKTREE_REPOSITORY = Symbol.for(
  "posthog.workspace.worktreeRepository",
);
export const ARCHIVE_REPOSITORY = Symbol.for(
  "posthog.workspace.archiveRepository",
);
export const SUSPENSION_REPOSITORY = Symbol.for(
  "posthog.workspace.suspensionRepository",
);
export const AUTH_SESSION_REPOSITORY = Symbol.for(
  "posthog.workspace.authSessionRepository",
);
export const AUTH_PREFERENCE_REPOSITORY = Symbol.for(
  "posthog.workspace.authPreferenceRepository",
);
export const DEFAULT_ADDITIONAL_DIRECTORY_REPOSITORY = Symbol.for(
  "posthog.workspace.defaultAdditionalDirectoryRepository",
);

// RTS repositories
export const NEST_REPOSITORY = Symbol.for(
  "posthog.workspace.rts.nestRepository",
);
export const NEST_MESSAGE_REPOSITORY = Symbol.for(
  "posthog.workspace.rts.nestMessageRepository",
);
export const HOGLET_REPOSITORY = Symbol.for(
  "posthog.workspace.rts.hogletRepository",
);
export const HEDGEHOG_STATE_REPOSITORY = Symbol.for(
  "posthog.workspace.rts.hedgehogStateRepository",
);
export const FEEDBACK_EVENT_REPOSITORY = Symbol.for(
  "posthog.workspace.rts.feedbackEventRepository",
);
export const OPERATOR_DECISION_REPOSITORY = Symbol.for(
  "posthog.workspace.rts.operatorDecisionRepository",
);
export const PR_DEPENDENCY_REPOSITORY = Symbol.for(
  "posthog.workspace.rts.prDependencyRepository",
);
export const TICK_LOG_REPOSITORY = Symbol.for(
  "posthog.workspace.rts.tickLogRepository",
);
export const USAGE_EVENT_REPOSITORY = Symbol.for(
  "posthog.workspace.rts.usageEventRepository",
);
