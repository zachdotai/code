import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
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
