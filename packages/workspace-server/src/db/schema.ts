import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () => text().notNull().default(sql`(CURRENT_TIMESTAMP)`);
const updatedAt = () => text().notNull().default(sql`(CURRENT_TIMESTAMP)`);

export const repositories = sqliteTable("repositories", {
  id: id(),
  path: text().notNull().unique(),
  remoteUrl: text(),
  lastAccessedAt: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: id(),
    taskId: text().notNull().unique(),
    repositoryId: text().references(() => repositories.id, {
      onDelete: "set null",
    }),
    mode: text({ enum: ["cloud", "local", "worktree"] }).notNull(),
    linkedBranch: text(),
    pinnedAt: text(),
    lastViewedAt: text(),
    lastActivityAt: text(),
    /** JSON-encoded array of absolute paths the agent can access for this task. */
    additionalDirectories: text().notNull().default("[]"),
    /** Cached PR URL for this task so task switches render without waiting on `gh`. */
    prUrl: text(),
    /** Cached PR state — values match the `SidebarPrState` union (open/merged/closed/draft). */
    prState: text({ enum: ["open", "merged", "closed", "draft"] }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("workspaces_repository_id_idx").on(t.repositoryId)],
);

export const worktrees = sqliteTable("worktrees", {
  id: id(),
  workspaceId: text()
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text().notNull(),
  path: text().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const archives = sqliteTable("archives", {
  id: id(),
  workspaceId: text()
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  branchName: text(),
  checkpointId: text(),
  archivedAt: text().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const suspensions = sqliteTable("suspensions", {
  id: id(),
  workspaceId: text()
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  branchName: text(),
  checkpointId: text(),
  suspendedAt: text().notNull(),
  reason: text({
    enum: ["max_worktrees", "inactivity", "manual"],
  }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authSessions = sqliteTable("auth_sessions", {
  id: integer().primaryKey(),
  refreshTokenEncrypted: text().notNull(),
  cloudRegion: text({ enum: ["us", "eu", "dev"] }).notNull(),
  selectedProjectId: integer(),
  scopeVersion: integer().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const defaultAdditionalDirectories = sqliteTable(
  "default_additional_directories",
  {
    path: text().primaryKey(),
    createdAt: createdAt(),
  },
);

export const rtsNests = sqliteTable(
  "rts_nest",
  {
    id: id(),
    name: text().notNull(),
    goalPrompt: text().notNull(),
    definitionOfDone: text(),
    mapX: integer().notNull(),
    mapY: integer().notNull(),
    status: text({
      enum: ["active", "validated", "dormant", "archived", "needs_attention"],
    })
      .notNull()
      .default("active"),
    health: text({
      enum: ["ok", "worktree_missing", "db_inconsistent"],
    })
      .notNull()
      .default("ok"),
    targetMetricId: text(),
    loadoutJson: text(),
    primaryRepository: text(),
    totalInputTokens: integer().notNull().default(0),
    totalOutputTokens: integer().notNull().default(0),
    totalCacheReadTokens: integer().notNull().default(0),
    totalCacheCreationTokens: integer().notNull().default(0),
    totalCostUsd: real().notNull().default(0),
    lastUsageAt: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rts_nest_status_idx").on(t.status)],
);

export const rtsHoglets = sqliteTable(
  "rts_hoglet",
  {
    id: id(),
    name: text(),
    taskId: text().notNull().unique(),
    nestId: text().references(() => rtsNests.id, {
      onDelete: "set null",
    }),
    signalReportId: text().unique(),
    affinityScore: real(),
    model: text(),
    totalInputTokens: integer().notNull().default(0),
    totalOutputTokens: integer().notNull().default(0),
    totalCacheReadTokens: integer().notNull().default(0),
    totalCacheCreationTokens: integer().notNull().default(0),
    totalCostUsd: real().notNull().default(0),
    lastUsageAt: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: text(),
  },
  (t) => [index("rts_hoglet_nest_id_idx").on(t.nestId)],
);

export const rtsNestMessages = sqliteTable(
  "rts_nest_message",
  {
    id: id(),
    nestId: text()
      .notNull()
      .references(() => rtsNests.id, { onDelete: "cascade" }),
    kind: text({
      enum: [
        "user_message",
        "hedgehog_message",
        "audit",
        "tool_result",
        "hoglet_summary",
        "hoglet_message",
      ],
    }).notNull(),
    visibility: text({ enum: ["summary", "detail"] })
      .notNull()
      .default("summary"),
    sourceTaskId: text(),
    body: text().notNull(),
    payloadJson: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("rts_nest_message_nest_id_idx").on(t.nestId),
    index("rts_nest_message_created_at_idx").on(t.createdAt),
  ],
);

export const rtsHedgehogState = sqliteTable("rts_hedgehog_state", {
  nestId: text()
    .primaryKey()
    .references(() => rtsNests.id, { onDelete: "cascade" }),
  state: text({
    enum: ["idle", "ticking", "proposing_completion"],
  })
    .notNull()
    .default("idle"),
  lastTickAt: text(),
  serializedStateJson: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const rtsFeedbackEvents = sqliteTable(
  "rts_feedback_event",
  {
    id: id(),
    nestId: text().references(() => rtsNests.id, {
      onDelete: "set null",
    }),
    hogletTaskId: text().notNull(),
    source: text({ enum: ["pr_review", "ci", "issue", "hedgehog"] }).notNull(),
    payloadHash: text().notNull(),
    payloadRef: text().notNull(),
    trustTier: text({ enum: ["operator", "internal", "external"] })
      .notNull()
      .default("external"),
    routedOutcome: text({
      enum: ["pending", "injected", "follow_up_spawned", "failed"],
    }).notNull(),
    processed: text({ enum: ["active", "queued", "unknown"] })
      .notNull()
      .default("unknown"),
    injectedAt: text().notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [
    uniqueIndex("rts_feedback_event_dedupe_idx").on(
      t.hogletTaskId,
      t.source,
      t.payloadHash,
    ),
    index("rts_feedback_event_nest_idx").on(t.nestId, t.injectedAt),
  ],
);

export const rtsPrDependencies = sqliteTable(
  "rts_pr_dependency",
  {
    id: id(),
    nestId: text()
      .notNull()
      .references(() => rtsNests.id, { onDelete: "cascade" }),
    parentTaskId: text().notNull(),
    childTaskId: text().notNull(),
    state: text({
      enum: ["pending", "satisfied", "broken", "follow_up"],
    }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("rts_pr_dependency_nest_idx").on(t.nestId),
    index("rts_pr_dependency_child_idx").on(t.childTaskId),
    uniqueIndex("rts_pr_dependency_triple_idx").on(
      t.nestId,
      t.parentTaskId,
      t.childTaskId,
    ),
  ],
);

export const rtsOperatorDecisions = sqliteTable(
  "rts_operator_decision",
  {
    id: id(),
    nestId: text()
      .notNull()
      .references(() => rtsNests.id, { onDelete: "cascade" }),
    kind: text({
      enum: ["suppress_signal_report", "revive_hoglet"],
    }).notNull(),
    subjectKey: text().notNull(),
    reason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("rts_operator_decision_nest_idx").on(t.nestId),
    uniqueIndex("rts_operator_decision_subject_idx").on(
      t.nestId,
      t.kind,
      t.subjectKey,
    ),
  ],
);

export const rtsUsageEvents = sqliteTable(
  "rts_usage_event",
  {
    id: id(),
    nestId: text().references(() => rtsNests.id, {
      onDelete: "set null",
    }),
    hogletId: text().references(() => rtsHoglets.id, {
      onDelete: "set null",
    }),
    taskId: text(),
    taskRunId: text(),
    turnIndex: integer(),
    team: text().notNull().default("posthog-code"),
    product: text().notNull().default("rts"),
    environment: text().notNull(),
    system: text().notNull().default("rts"),
    workload: text({
      enum: ["hedgehog-tick", "brood-hoglet", "wild-hoglet"],
    }).notNull(),
    purpose: text(),
    model: text().notNull(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    cacheReadTokens: integer().notNull().default(0),
    cacheCreationTokens: integer().notNull().default(0),
    costUsd: real().notNull().default(0),
    costSource: text({ enum: ["sdk", "pricing_table"] }).notNull(),
    occurredAt: text().notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [
    index("rts_usage_event_nest_idx").on(t.nestId, t.occurredAt),
    index("rts_usage_event_hoglet_idx").on(t.hogletId, t.occurredAt),
    index("rts_usage_event_occurred_at_idx").on(t.occurredAt),
    index("rts_usage_event_workload_idx").on(t.workload, t.occurredAt),
    uniqueIndex("rts_usage_event_dedupe_idx").on(t.taskRunId, t.turnIndex),
  ],
);

export const rtsTickLog = sqliteTable(
  "rts_tick_log",
  {
    id: id(),
    nestId: text()
      .notNull()
      .references(() => rtsNests.id, { onDelete: "cascade" }),
    tickedAt: text().notNull().default(sql`(CURRENT_TIMESTAMP)`),
    outcome: text({
      enum: ["completed", "errored", "aborted", "capped"],
    }).notNull(),
  },
  (t) => [index("rts_tick_log_window_idx").on(t.nestId, t.tickedAt)],
);

export const authPreferences = sqliteTable(
  "auth_preferences",
  {
    accountKey: text().notNull(),
    cloudRegion: text({ enum: ["us", "eu", "dev"] }).notNull(),
    lastSelectedProjectId: integer(),
    lastSelectedOrgId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("auth_preferences_account_region_idx").on(
      t.accountKey,
      t.cloudRegion,
    ),
  ],
);

export const authOrgProjectPreferences = sqliteTable(
  "auth_org_project_preferences",
  {
    accountKey: text().notNull(),
    cloudRegion: text({ enum: ["us", "eu", "dev"] }).notNull(),
    orgId: text().notNull(),
    lastSelectedProjectId: integer().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("auth_org_project_account_region_org_idx").on(
      t.accountKey,
      t.cloudRegion,
      t.orgId,
    ),
  ],
);
