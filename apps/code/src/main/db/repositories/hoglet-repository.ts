import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { hedgemonyHoglets } from "../schema";
import type { DatabaseService } from "../service";

export type Hoglet = typeof hedgemonyHoglets.$inferSelect;
export type NewHoglet = typeof hedgemonyHoglets.$inferInsert;

export interface CreateHogletData {
  taskId: string;
  name?: string | null;
  nestId?: string | null;
  signalReportId?: string | null;
  affinityScore?: number | null;
}

export interface UpdateHogletData {
  nestId?: string | null;
  signalReportId?: string | null;
  affinityScore?: number | null;
}

const byId = (id: string) => eq(hedgemonyHoglets.id, id);
const notDeleted = isNull(hedgemonyHoglets.deletedAt);
// "Wild" is now every non-nested, non-deleted hoglet — both operator-spawned
// ad-hoc work and signal-backed hoglets the affinity router didn't auto-route.
// They all share one wild bucket and render directly on the map.
const isWild = and(isNull(hedgemonyHoglets.nestId), notDeleted);
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

  findBySignalReportId(signalReportId: string): Hoglet | null {
    return (
      this.db
        .select()
        .from(hedgemonyHoglets)
        .where(eq(hedgemonyHoglets.signalReportId, signalReportId))
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

  findAllNames(): string[] {
    return this.db
      .select({ name: hedgemonyHoglets.name })
      .from(hedgemonyHoglets)
      .where(and(isNotNull(hedgemonyHoglets.name), notDeleted))
      .all()
      .map((row) => row.name)
      .filter((n): n is string => n !== null);
  }

  create(data: CreateHogletData): Hoglet {
    const timestamp = now();
    const id = crypto.randomUUID();
    const row: NewHoglet = {
      id,
      name: data.name ?? null,
      taskId: data.taskId,
      nestId: data.nestId ?? null,
      signalReportId: data.signalReportId ?? null,
      affinityScore: data.affinityScore ?? null,
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
