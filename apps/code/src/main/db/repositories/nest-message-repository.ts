import { and, asc, eq, or } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { hedgemonyNestMessages } from "../schema";
import type { DatabaseService } from "../service";

export type NestMessage = typeof hedgemonyNestMessages.$inferSelect;
export type NewNestMessage = typeof hedgemonyNestMessages.$inferInsert;
export type NestMessageKind =
  | "user_message"
  | "hedgehog_message"
  | "audit"
  | "tool_result"
  | "hoglet_summary";
export type NestMessageVisibility = "summary" | "detail";

export interface CreateNestMessageData {
  nestId: string;
  kind: NestMessageKind;
  visibility?: NestMessageVisibility;
  sourceTaskId?: string | null;
  body: string;
  payloadJson?: string | null;
}

export interface CompactNestContextResult {
  deletedDetailMessages: number;
  compactedContextMessages: number;
}

const byNestId = (nestId: string) => eq(hedgemonyNestMessages.nestId, nestId);
const now = () => new Date().toISOString();

const COMPACTED_CONTEXT_BODY =
  "Earlier nest context was compacted after completion. The nest goal, definition of done, completion summary, task handles, and PR handles remain available.";

@injectable()
export class NestMessageRepository {
  constructor(
    @inject(MAIN_TOKENS.DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  listByNestId(nestId: string): NestMessage[] {
    return this.db
      .select()
      .from(hedgemonyNestMessages)
      .where(byNestId(nestId))
      .orderBy(asc(hedgemonyNestMessages.createdAt))
      .all();
  }

  create(data: CreateNestMessageData): NestMessage {
    const id = crypto.randomUUID();
    const row: NewNestMessage = {
      id,
      nestId: data.nestId,
      kind: data.kind,
      visibility: data.visibility ?? "summary",
      sourceTaskId: data.sourceTaskId ?? null,
      body: data.body,
      payloadJson: data.payloadJson ?? null,
      createdAt: now(),
    };

    this.db.insert(hedgemonyNestMessages).values(row).run();

    const created = this.db
      .select()
      .from(hedgemonyNestMessages)
      .where(eq(hedgemonyNestMessages.id, id))
      .get();

    if (!created) {
      throw new Error(`Failed to create nest message ${id}`);
    }

    return created;
  }

  compactCompletedContext(nestId: string): CompactNestContextResult {
    const deletedDetailMessages = this.db
      .delete(hedgemonyNestMessages)
      .where(
        and(byNestId(nestId), eq(hedgemonyNestMessages.visibility, "detail")),
      )
      .run().changes;

    const compactedContextMessages = this.db
      .update(hedgemonyNestMessages)
      .set({
        body: COMPACTED_CONTEXT_BODY,
        payloadJson: null,
        visibility: "summary",
      })
      .where(
        and(
          byNestId(nestId),
          or(
            eq(hedgemonyNestMessages.kind, "user_message"),
            eq(hedgemonyNestMessages.kind, "tool_result"),
            eq(hedgemonyNestMessages.kind, "hoglet_summary"),
          ),
        ),
      )
      .run().changes;

    return { deletedDetailMessages, compactedContextMessages };
  }
}
