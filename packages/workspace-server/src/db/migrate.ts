import type Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";

type SqliteDatabase = InstanceType<typeof Database>;

function isDuplicateColumnError(error: unknown): boolean {
  return error instanceof Error && /duplicate column name/i.test(error.message);
}

// Repair migrations heal DBs whose recorded history diverged from their real
// schema (a migration amended in place on a branch). Their statements are
// opportunistic: one that cannot apply must not roll back the batch and kill
// boot — for these migrations the worst acceptable outcome is the pre-repair
// status quo, never a database that fails to open. Statements in the listed
// migrations tolerate ANY SQLite error; everything else keeps the strict
// duplicate-column-only tolerance.
const BEST_EFFORT_MIGRATIONS = new Set<number>([
  1783685997328, // 0020_repair_browser_tabs_schema
]);

// Guarded migrations are DESTRUCTIVE to re-run, so when the schema is already
// past a migration's precondition (ledger behind schema — an amended migration
// on a branch) the probe fails and the migration is recorded as applied and
// skipped instead of re-executed. Probes must be reads that succeed on the
// pre-migration schema and fail after it.
const MIGRATION_GUARDS = new Map<number, string>([
  // 0021_tab_owned_panes: its backfill reads browser_tabs.dashboard_id (gone
  // after the migration), and its DROP TABLE browser_panes would wipe live
  // pane rows on a re-run.
  [1783800060350, "SELECT dashboard_id FROM browser_tabs LIMIT 0"],
]);

export function runMigrations(
  sqlite: SqliteDatabase,
  migrationsFolder: string,
): void {
  const migrations = readMigrationFiles({ migrationsFolder });

  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
  );

  const appliedTimestamps = new Set(
    sqlite
      .prepare("SELECT created_at FROM __drizzle_migrations")
      .all()
      .map((row) => Number((row as { created_at: number }).created_at)),
  );

  const recordMigration = sqlite.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  );

  const applyPending = sqlite.transaction(() => {
    for (const migration of migrations) {
      if (appliedTimestamps.has(migration.folderMillis)) {
        continue;
      }
      const guard = MIGRATION_GUARDS.get(migration.folderMillis);
      if (guard) {
        try {
          sqlite.exec(guard);
        } catch {
          recordMigration.run(migration.hash, migration.folderMillis);
          continue;
        }
      }
      const bestEffort = BEST_EFFORT_MIGRATIONS.has(migration.folderMillis);
      for (const statement of migration.sql) {
        try {
          sqlite.exec(statement);
        } catch (error) {
          if (bestEffort || isDuplicateColumnError(error)) {
            continue;
          }
          throw error;
        }
      }
      recordMigration.run(migration.hash, migration.folderMillis);
    }
  });

  applyPending();
}
