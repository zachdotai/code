import { eq, ne, sql } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { rtsNests } from "../schema";
import type { DatabaseService } from "../service";

export type Nest = typeof rtsNests.$inferSelect;
export type NewNest = typeof rtsNests.$inferInsert;

export interface IncrementUsageData {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  occurredAt: string;
}
export type NestStatus =
  | "active"
  | "validated"
  | "dormant"
  | "archived"
  | "needs_attention";
export type NestHealth = "ok" | "worktree_missing" | "db_inconsistent";

export interface CreateNestData {
  name: string;
  goalPrompt: string;
  definitionOfDone?: string | null;
  mapX: number;
  mapY: number;
  primaryRepository?: string | null;
}

export interface UpdateNestData {
  name?: string;
  goalPrompt?: string;
  definitionOfDone?: string | null;
  mapX?: number;
  mapY?: number;
  status?: NestStatus;
  health?: NestHealth;
  primaryRepository?: string | null;
}

const byId = (id: string) => eq(rtsNests.id, id);
const notArchived = ne(rtsNests.status, "archived");
const now = () => new Date().toISOString();

@injectable()
export class NestRepository {
  constructor(
    @inject(MAIN_TOKENS.DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  findById(id: string): Nest | null {
    return this.db.select().from(rtsNests).where(byId(id)).get() ?? null;
  }

  findAll(): Nest[] {
    return this.db.select().from(rtsNests).all();
  }

  findAllVisible(): Nest[] {
    return this.db.select().from(rtsNests).where(notArchived).all();
  }

  create(data: CreateNestData): Nest {
    const timestamp = now();
    const id = crypto.randomUUID();
    const row: NewNest = {
      id,
      name: data.name,
      goalPrompt: data.goalPrompt,
      definitionOfDone: data.definitionOfDone ?? null,
      mapX: data.mapX,
      mapY: data.mapY,
      status: "active",
      loadoutJson: "{}",
      primaryRepository: data.primaryRepository ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db.insert(rtsNests).values(row).run();
    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to create nest ${id}`);
    }
    return created;
  }

  update(id: string, data: UpdateNestData): Nest | null {
    const existing = this.findById(id);
    if (!existing) return null;

    this.db
      .update(rtsNests)
      .set({ ...data, updatedAt: now() })
      .where(byId(id))
      .run();

    return this.findById(id);
  }

  archive(id: string): Nest | null {
    return this.update(id, { status: "archived" });
  }

  unarchive(id: string): Nest | null {
    return this.update(id, { status: "active" });
  }

  incrementUsage(id: string, data: IncrementUsageData): void {
    this.db
      .update(rtsNests)
      .set({
        totalInputTokens: sql`${rtsNests.totalInputTokens} + ${data.inputTokens}`,
        totalOutputTokens: sql`${rtsNests.totalOutputTokens} + ${data.outputTokens}`,
        totalCacheReadTokens: sql`${rtsNests.totalCacheReadTokens} + ${data.cacheReadTokens}`,
        totalCacheCreationTokens: sql`${rtsNests.totalCacheCreationTokens} + ${data.cacheCreationTokens}`,
        totalCostUsd: sql`${rtsNests.totalCostUsd} + ${data.costUsd}`,
        lastUsageAt: data.occurredAt,
        updatedAt: now(),
      })
      .where(byId(id))
      .run();
  }
}
