import { and, eq, isNull, sql } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { hedgemonyHoglets } from "../schema";
import type { DatabaseService } from "../service";

export type Hoglet = typeof hedgemonyHoglets.$inferSelect;
export type NewHoglet = typeof hedgemonyHoglets.$inferInsert;

export interface CreateHogletData {
  taskId: string;
  nestId?: string | null;
  signalReportId?: string | null;
}

export interface UpdateHogletData {
  nestId?: string | null;
  signalReportId?: string | null;
}

const byId = (id: string) => eq(hedgemonyHoglets.id, id);
const notDeleted = isNull(hedgemonyHoglets.deletedAt);
const isWild = and(
  isNull(hedgemonyHoglets.nestId),
  isNull(hedgemonyHoglets.signalReportId),
  notDeleted,
);
const now = () => new Date().toISOString();

@injectable()
export class HogletRepository {
  constructor(
    @inject(MAIN_TOKENS.DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  findById(id: string): Hoglet | null {
    return (
      this.db.select().from(hedgemonyHoglets).where(byId(id)).get() ?? null
    );
  }

  findByTaskId(taskId: string): Hoglet | null {
    return (
      this.db
        .select()
        .from(hedgemonyHoglets)
        .where(eq(hedgemonyHoglets.taskId, taskId))
        .get() ?? null
    );
  }

  findAllWild(): Hoglet[] {
    return this.db.select().from(hedgemonyHoglets).where(isWild).all();
  }

  findAllForNest(nestId: string): Hoglet[] {
    return this.db
      .select()
      .from(hedgemonyHoglets)
      .where(and(eq(hedgemonyHoglets.nestId, nestId), notDeleted))
      .all();
  }

  countWild(): number {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(hedgemonyHoglets)
      .where(isWild)
      .get();
    return row?.count ?? 0;
  }

  create(data: CreateHogletData): Hoglet {
    const timestamp = now();
    const id = crypto.randomUUID();
    const row: NewHoglet = {
      id,
      taskId: data.taskId,
      nestId: data.nestId ?? null,
      signalReportId: data.signalReportId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db.insert(hedgemonyHoglets).values(row).run();
    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to create hoglet ${id}`);
    }
    return created;
  }

  update(id: string, data: UpdateHogletData): Hoglet | null {
    const existing = this.findById(id);
    if (!existing) return null;

    this.db
      .update(hedgemonyHoglets)
      .set({ ...data, updatedAt: now() })
      .where(byId(id))
      .run();

    return this.findById(id);
  }

  softDelete(id: string): Hoglet | null {
    const existing = this.findById(id);
    if (!existing) return null;
    const timestamp = now();
    this.db
      .update(hedgemonyHoglets)
      .set({ deletedAt: timestamp, updatedAt: timestamp })
      .where(byId(id))
      .run();
    return this.findById(id);
  }
}
