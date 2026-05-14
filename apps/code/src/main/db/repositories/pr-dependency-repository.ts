import { eq } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { hedgemonyPrDependencies } from "../schema";
import type { DatabaseService } from "../service";

export type PrDependency = typeof hedgemonyPrDependencies.$inferSelect;
export type NewPrDependency = typeof hedgemonyPrDependencies.$inferInsert;

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
    this.db.insert(hedgemonyPrDependencies).values(row).run();
    const created = this.db
      .select()
      .from(hedgemonyPrDependencies)
      .where(eq(hedgemonyPrDependencies.id, id))
      .get();
    if (!created) {
      throw new Error(`Failed to create pr dependency ${id}`);
    }
    return created;
  }

  listForNest(nestId: string): PrDependency[] {
    return this.db
      .select()
      .from(hedgemonyPrDependencies)
      .where(eq(hedgemonyPrDependencies.nestId, nestId))
      .all();
  }
}
