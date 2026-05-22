import { eq } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../../di/tokens";
import { rtsHedgehogState } from "../../schema";
import type { DatabaseService } from "../../service";

export type HedgehogState = typeof rtsHedgehogState.$inferSelect;
export type NewHedgehogState = typeof rtsHedgehogState.$inferInsert;
export type HedgehogTickState = "idle" | "ticking" | "proposing_completion";

export interface UpsertHedgehogStateData {
  nestId: string;
  state?: HedgehogTickState;
  lastTickAt?: string | null;
  serializedStateJson?: string | null;
}

const byNestId = (nestId: string) => eq(rtsHedgehogState.nestId, nestId);
const now = () => new Date().toISOString();

@injectable()
export class HedgehogStateRepository {
  constructor(
    @inject(MAIN_TOKENS.DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  findByNestId(nestId: string): HedgehogState | null {
    return (
      this.db
        .select()
        .from(rtsHedgehogState)
        .where(byNestId(nestId))
        .get() ?? null
    );
  }

  upsert(data: UpsertHedgehogStateData): HedgehogState {
    const existing = this.findByNestId(data.nestId);
    if (existing) {
      const patch: Partial<NewHedgehogState> = { updatedAt: now() };
      if (data.state !== undefined) patch.state = data.state;
      if (data.lastTickAt !== undefined) patch.lastTickAt = data.lastTickAt;
      if (data.serializedStateJson !== undefined) {
        patch.serializedStateJson = data.serializedStateJson;
      }
      this.db
        .update(rtsHedgehogState)
        .set(patch)
        .where(byNestId(data.nestId))
        .run();
    } else {
      const timestamp = now();
      const row: NewHedgehogState = {
        nestId: data.nestId,
        state: data.state ?? "idle",
        lastTickAt: data.lastTickAt ?? null,
        serializedStateJson: data.serializedStateJson ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.db.insert(rtsHedgehogState).values(row).run();
    }
    const result = this.findByNestId(data.nestId);
    if (!result) {
      throw new Error(`Failed to upsert hedgehog state for ${data.nestId}`);
    }
    return result;
  }

  /**
   * Resets any nest stuck in `ticking` back to `idle`. Called at boot so a
   * force-quit mid-tick doesn't leave the row in a state the renderer would
   * render as a perpetual glow.
   */
  resetStuckTicks(): HedgehogState[] {
    const stuck = this.db
      .select()
      .from(rtsHedgehogState)
      .where(eq(rtsHedgehogState.state, "ticking"))
      .all();
    if (stuck.length === 0) return [];
    this.db
      .update(rtsHedgehogState)
      .set({ state: "idle", updatedAt: now() })
      .where(eq(rtsHedgehogState.state, "ticking"))
      .run();
    return stuck.map((row) => ({ ...row, state: "idle" }));
  }

  delete(nestId: string): void {
    this.db.delete(rtsHedgehogState).where(byNestId(nestId)).run();
  }
}
