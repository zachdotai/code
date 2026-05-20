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

export const rtsNests = sqliteTable(
  "hedgemony_nest",
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
  (t) => [index("hedgemony_nest_status_idx").on(t.status)],
);

export const rtsHoglets = sqliteTable(
  "hedgemony_hoglet",
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
  (t) => [index("hedgemony_hoglet_nest_id_idx").on(t.nestId)],
);

export const rtsNestMessages = sqliteTable(
  "hedgemony_nest_message",
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
    index("hedgemony_nest_message_nest_id_idx").on(t.nestId),
    index("hedgemony_nest_message_created_at_idx").on(t.createdAt),
  ],
);

export const rtsHedgehogState = sqliteTable("hedgemony_hedgehog_state", {
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
  "hedgemony_feedback_event",
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
    uniqueIndex("hedgemony_feedback_event_dedupe_idx").on(
      t.hogletTaskId,
      t.source,
      t.payloadHash,
    ),
    index("hedgemony_feedback_event_nest_idx").on(t.nestId, t.injectedAt),
  ],
);

export const rtsPrDependencies = sqliteTable(
  "hedgemony_pr_dependency",
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
    index("hedgemony_pr_dependency_nest_idx").on(t.nestId),
    index("hedgemony_pr_dependency_child_idx").on(t.childTaskId),
    uniqueIndex("hedgemony_pr_dependency_triple_idx").on(
      t.nestId,
      t.parentTaskId,
      t.childTaskId,
    ),
  ],
);

export const rtsOperatorDecisions = sqliteTable(
  "hedgemony_operator_decision",
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
    index("hedgemony_operator_decision_nest_idx").on(t.nestId),
    uniqueIndex("hedgemony_operator_decision_subject_idx").on(
      t.nestId,
      t.kind,
      t.subjectKey,
    ),
  ],
);

export const rtsUsageEvents = sqliteTable(
  "hedgemony_usage_event",
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
    product: text().notNull().default("hedgemony"),
    environment: text().notNull(),
    system: text().notNull().default("hedgemony"),
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
    index("hedgemony_usage_event_nest_idx").on(t.nestId, t.occurredAt),
    index("hedgemony_usage_event_hoglet_idx").on(t.hogletId, t.occurredAt),
    index("hedgemony_usage_event_occurred_at_idx").on(t.occurredAt),
    index("hedgemony_usage_event_workload_idx").on(t.workload, t.occurredAt),
    uniqueIndex("hedgemony_usage_event_dedupe_idx").on(
      t.taskRunId,
      t.turnIndex,
    ),
  ],
);

export const rtsTickLog = sqliteTable(
  "hedgemony_tick_log",
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
  (t) => [index("hedgemony_tick_log_window_idx").on(t.nestId, t.tickedAt)],
);

export const authPreferences = sqliteTable(
  "auth_preferences",
  {
    accountKey: text().notNull(),
    cloudRegion: text({ enum: ["us", "eu", "dev"] }).notNull(),
    lastSelectedProjectId: integer(),
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
