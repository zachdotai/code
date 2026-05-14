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

export const hedgemonyNests = sqliteTable(
  "hedgemony_nest",
  {
    id: id(),
    name: text().notNull(),
    goalPrompt: text().notNull(),
    definitionOfDone: text(),
    mapX: integer().notNull(),
    mapY: integer().notNull(),
    status: text({
      enum: ["active", "dormant", "archived", "needs_attention"],
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("hedgemony_nest_status_idx").on(t.status)],
);

export const hedgemonyHoglets = sqliteTable(
  "hedgemony_hoglet",
  {
    id: id(),
    taskId: text().notNull().unique(),
    nestId: text().references(() => hedgemonyNests.id, {
      onDelete: "set null",
    }),
    signalReportId: text().unique(),
    affinityScore: real(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: text(),
  },
  (t) => [index("hedgemony_hoglet_nest_id_idx").on(t.nestId)],
);

export const hedgemonyNestMessages = sqliteTable(
  "hedgemony_nest_message",
  {
    id: id(),
    nestId: text()
      .notNull()
      .references(() => hedgemonyNests.id, { onDelete: "cascade" }),
    kind: text({
      enum: [
        "user_message",
        "hedgehog_message",
        "audit",
        "tool_result",
        "hoglet_summary",
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

export const hedgemonyHedgehogState = sqliteTable("hedgemony_hedgehog_state", {
  nestId: text()
    .primaryKey()
    .references(() => hedgemonyNests.id, { onDelete: "cascade" }),
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

export const hedgemonyFeedbackEvents = sqliteTable(
  "hedgemony_feedback_event",
  {
    id: id(),
    nestId: text().references(() => hedgemonyNests.id, {
      onDelete: "set null",
    }),
    hogletTaskId: text().notNull(),
    source: text({ enum: ["pr_review", "ci", "issue"] }).notNull(),
    payloadHash: text().notNull(),
    payloadRef: text().notNull(),
    trustTier: text({ enum: ["operator", "internal", "external"] })
      .notNull()
      .default("external"),
    routedOutcome: text({
      enum: ["injected", "follow_up_spawned", "failed"],
    }).notNull(),
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

export const hedgemonyPrDependencies = sqliteTable(
  "hedgemony_pr_dependency",
  {
    id: id(),
    nestId: text()
      .notNull()
      .references(() => hedgemonyNests.id, { onDelete: "cascade" }),
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
  ],
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
