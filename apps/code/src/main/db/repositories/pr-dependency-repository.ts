import { and, eq } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { rtsPrDependencies } from "../schema";
import type { DatabaseService } from "../service";

export type PrDependency = typeof rtsPrDependencies.$inferSelect;
export type NewPrDependency = typeof rtsPrDependencies.$inferInsert;

export type PrDependencyState =
  | "pending"
  | "satisfied"
  | "broken"
  | "follow_up";

export interface CreatePrDependencyData {
  nestId: string;
  parentTaskId: string;
  childTaskId: string;
  state: PrDependencyState;
}

@injectable()
export class PrDependencyRepository {
  constructor(
    @inject(MAIN_TOKENS.DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  insert(data: CreatePrDependencyData): PrDependency {
    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();
    const row: NewPrDependency = {
      id,
      nestId: data.nestId,
      parentTaskId: data.parentTaskId,
      childTaskId: data.childTaskId,
      state: data.state,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db.insert(rtsPrDependencies).values(row).run();
    const created = this.db
      .select()
      .from(rtsPrDependencies)
      .where(eq(rtsPrDependencies.id, id))
      .get();
    if (!created) {
      throw new Error(`Failed to create pr dependency ${id}`);
    }
    return created;
  }

  /**
   * Idempotent insert. Returns the existing row if a `(nestId, parentTaskId,
   * childTaskId)` edge already exists, otherwise inserts a new `pending` (or
   * caller-provided) row. The schema enforces a UNIQUE index on this triple
   * (migration 0014), so the conflict resolution happens inside sqlite and
   * `link_pr_dependency` is race-free even under concurrent ticks.
   */
  insertOrIgnore(data: CreatePrDependencyData): {
    inserted: boolean;
    row: PrDependency;
  } {
    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();
    const row: NewPrDependency = {
      id,
      nestId: data.nestId,
      parentTaskId: data.parentTaskId,
      childTaskId: data.childTaskId,
      state: data.state,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const returned = this.db
      .insert(rtsPrDependencies)
      .values(row)
      .onConflictDoNothing({
        target: [
          rtsPrDependencies.nestId,
          rtsPrDependencies.parentTaskId,
          rtsPrDependencies.childTaskId,
        ],
      })
      .returning()
      .all();
    if (returned.length > 0) {
      return { inserted: true, row: returned[0] };
    }
    const existing = this.findByTriple({
      nestId: data.nestId,
      parentTaskId: data.parentTaskId,
      childTaskId: data.childTaskId,
    });
    if (!existing) {
      throw new Error(
        `Insert conflict but no existing pr dependency for ${data.parentTaskId} → ${data.childTaskId}`,
      );
    }
    return { inserted: false, row: existing };
  }

  findById(id: string): PrDependency | null {
    return (
      this.db
        .select()
        .from(rtsPrDependencies)
        .where(eq(rtsPrDependencies.id, id))
        .get() ?? null
    );
  }

  findByTriple(key: {
    nestId: string;
    parentTaskId: string;
    childTaskId: string;
  }): PrDependency | null {
    return (
      this.db
        .select()
        .from(rtsPrDependencies)
        .where(
          and(
            eq(rtsPrDependencies.nestId, key.nestId),
            eq(rtsPrDependencies.parentTaskId, key.parentTaskId),
            eq(rtsPrDependencies.childTaskId, key.childTaskId),
          ),
        )
        .get() ?? null
    );
  }

  findPending(): PrDependency[] {
    return this.db
      .select()
      .from(rtsPrDependencies)
      .where(eq(rtsPrDependencies.state, "pending"))
      .all();
  }

  findByParentTaskId(parentTaskId: string): PrDependency[] {
    return this.db
      .select()
      .from(rtsPrDependencies)
      .where(eq(rtsPrDependencies.parentTaskId, parentTaskId))
      .all();
  }

  findByChildTaskId(childTaskId: string): PrDependency[] {
    return this.db
      .select()
      .from(rtsPrDependencies)
      .where(eq(rtsPrDependencies.childTaskId, childTaskId))
      .all();
  }

  listForNest(nestId: string): PrDependency[] {
    return this.db
      .select()
      .from(rtsPrDependencies)
      .where(eq(rtsPrDependencies.nestId, nestId))
      .all();
  }

  updateState(id: string, state: PrDependencyState): PrDependency {
    const timestamp = new Date().toISOString();
    this.db
      .update(rtsPrDependencies)
      .set({ state, updatedAt: timestamp })
      .where(eq(rtsPrDependencies.id, id))
      .run();
    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`pr dependency ${id} not found after state update`);
    }
    return updated;
  }

  delete(id: string): void {
    this.db
      .delete(rtsPrDependencies)
      .where(eq(rtsPrDependencies.id, id))
      .run();
  }
}
