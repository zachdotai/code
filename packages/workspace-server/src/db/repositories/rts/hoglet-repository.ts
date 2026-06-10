import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { DATABASE_SERVICE } from "../../identifiers";
import { rtsHoglets } from "../../schema";
import type { DatabaseService } from "../../service";

export type Hoglet = typeof rtsHoglets.$inferSelect;
export type NewHoglet = typeof rtsHoglets.$inferInsert;

export interface CreateHogletData {
  taskId: string;
  name?: string | null;
  nestId?: string | null;
  signalReportId?: string | null;
  affinityScore?: number | null;
  model?: string | null;
}

export interface UpdateHogletData {
  nestId?: string | null;
  signalReportId?: string | null;
  affinityScore?: number | null;
  model?: string | null;
}

export interface IncrementUsageData {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  occurredAt: string;
}

const byId = (id: string) => eq(rtsHoglets.id, id);
const notDeleted = isNull(rtsHoglets.deletedAt);
// "Wild" is now every non-nested, non-deleted hoglet — both operator-spawned
// ad-hoc work and signal-backed hoglets the affinity router didn't auto-route.
// They all share one wild bucket and render directly on the map.
const isWild = and(isNull(rtsHoglets.nestId), notDeleted);
const now = () => new Date().toISOString();

@injectable()
export class HogletRepository {
  constructor(
    @inject(DATABASE_SERVICE)
    private readonly databaseService: DatabaseService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  findById(id: string): Hoglet | null {
    return this.db.select().from(rtsHoglets).where(byId(id)).get() ?? null;
  }

  findByTaskId(taskId: string): Hoglet | null {
    return (
      this.db
        .select()
        .from(rtsHoglets)
        .where(eq(rtsHoglets.taskId, taskId))
        .get() ?? null
    );
  }

  findBySignalReportId(signalReportId: string): Hoglet | null {
    return (
      this.db
        .select()
        .from(rtsHoglets)
        .where(eq(rtsHoglets.signalReportId, signalReportId))
        .get() ?? null
    );
  }

  findAllWild(): Hoglet[] {
    return this.db.select().from(rtsHoglets).where(isWild).all();
  }

  findAllForNest(nestId: string): Hoglet[] {
    return this.db
      .select()
      .from(rtsHoglets)
      .where(and(eq(rtsHoglets.nestId, nestId), notDeleted))
      .all();
  }

  countWild(): number {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(rtsHoglets)
      .where(isWild)
      .get();
    return row?.count ?? 0;
  }

  findAllNames(): string[] {
    return this.db
      .select({ name: rtsHoglets.name })
      .from(rtsHoglets)
      .where(and(isNotNull(rtsHoglets.name), notDeleted))
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
      model: data.model ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db.insert(rtsHoglets).values(row).run();
    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to create hoglet ${id}`);
    }
    return created;
  }

  incrementUsage(id: string, data: IncrementUsageData): void {
    this.db
      .update(rtsHoglets)
      .set({
        totalInputTokens: sql`${rtsHoglets.totalInputTokens} + ${data.inputTokens}`,
        totalOutputTokens: sql`${rtsHoglets.totalOutputTokens} + ${data.outputTokens}`,
        totalCacheReadTokens: sql`${rtsHoglets.totalCacheReadTokens} + ${data.cacheReadTokens}`,
        totalCacheCreationTokens: sql`${rtsHoglets.totalCacheCreationTokens} + ${data.cacheCreationTokens}`,
        totalCostUsd: sql`${rtsHoglets.totalCostUsd} + ${data.costUsd}`,
        lastUsageAt: data.occurredAt,
        updatedAt: now(),
      })
      .where(byId(id))
      .run();
  }

  update(id: string, data: UpdateHogletData): Hoglet | null {
    const existing = this.findById(id);
    if (!existing) return null;

    this.db
      .update(rtsHoglets)
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
      .update(rtsHoglets)
      .set({ deletedAt: timestamp, updatedAt: timestamp })
      .where(byId(id))
      .run();
    return this.findById(id);
  }
}
