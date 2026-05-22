import { and, asc, eq, or } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../../di/tokens";
import { rtsNestMessages } from "../../schema";
import type { DatabaseService } from "../../service";

export type NestMessage = typeof rtsNestMessages.$inferSelect;
export type NewNestMessage = typeof rtsNestMessages.$inferInsert;
export type NestMessageKind =
  | "user_message"
  | "hedgehog_message"
  | "audit"
  | "tool_result"
  | "hoglet_summary"
  | "hoglet_message";
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

const byNestId = (nestId: string) => eq(rtsNestMessages.nestId, nestId);
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
      .from(rtsNestMessages)
      .where(byNestId(nestId))
      .orderBy(asc(rtsNestMessages.createdAt))
      .all();
  }

  findHogletSummaryByRun(
    nestId: string,
    sourceTaskId: string,
    runId: string,
  ): NestMessage | null {
    return this.findBySourceTaskRun({
      nestId,
      kind: "hoglet_summary",
      sourceTaskId,
      runId,
    });
  }

  findHogletMessageByTurn(
    nestId: string,
    sourceTaskId: string,
    runId: string,
    turnIndex: number,
  ): NestMessage | null {
    return this.findBySourceTaskRun({
      nestId,
      kind: "hoglet_message",
      sourceTaskId,
      runId,
      turnIndex,
    });
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

    this.db.insert(rtsNestMessages).values(row).run();

    const created = this.db
      .select()
      .from(rtsNestMessages)
      .where(eq(rtsNestMessages.id, id))
      .get();

    if (!created) {
      throw new Error(`Failed to create nest message ${id}`);
    }

    return created;
  }

  private findBySourceTaskRun(input: {
    nestId: string;
    kind: NestMessageKind;
    sourceTaskId: string;
    runId: string;
    payloadType?: string;
    turnIndex?: number;
  }): NestMessage | null {
    const candidates = this.db
      .select()
      .from(rtsNestMessages)
      .where(
        and(
          byNestId(input.nestId),
          eq(rtsNestMessages.kind, input.kind),
          eq(rtsNestMessages.sourceTaskId, input.sourceTaskId),
        ),
      )
      .orderBy(asc(rtsNestMessages.createdAt))
      .all();

    return (
      candidates.find((message) =>
        payloadMatchesRun(message.payloadJson, input.runId, {
          payloadType: input.payloadType,
          turnIndex: input.turnIndex,
        }),
      ) ?? null
    );
  }

  compactCompletedContext(nestId: string): CompactNestContextResult {
    const deletedDetailMessages = this.db
      .delete(rtsNestMessages)
      .where(
        and(byNestId(nestId), eq(rtsNestMessages.visibility, "detail")),
      )
      .run().changes;

    const compactedContextMessages = this.db
      .update(rtsNestMessages)
      .set({
        body: COMPACTED_CONTEXT_BODY,
        payloadJson: null,
        visibility: "summary",
      })
      .where(
        and(
          byNestId(nestId),
          or(
            eq(rtsNestMessages.kind, "user_message"),
            eq(rtsNestMessages.kind, "tool_result"),
            eq(rtsNestMessages.kind, "hoglet_summary"),
            eq(rtsNestMessages.kind, "hoglet_message"),
          ),
        ),
      )
      .run().changes;

    return { deletedDetailMessages, compactedContextMessages };
  }
}

function payloadMatchesRun(
  payloadJson: string | null,
  runId: string,
  options: { payloadType?: string; turnIndex?: number },
): boolean {
  if (!payloadJson) return false;
  try {
    const payload = JSON.parse(payloadJson) as {
      runId?: unknown;
      type?: unknown;
      turnIndex?: unknown;
    };
    if (payload.runId !== runId) return false;
    if (options.payloadType && payload.type !== options.payloadType) {
      return false;
    }
    if (
      options.turnIndex !== undefined &&
      payload.turnIndex !== options.turnIndex
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
