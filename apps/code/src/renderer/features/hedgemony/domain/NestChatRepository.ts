import type { NestMessage } from "@main/services/hedgemony/schemas";

/**
 * Narrow interface over per-nest chat message state. Used by the nest
 * subscription service to append live message_appended events.
 */
export interface NestChatRepository {
  append(nestId: string, message: NestMessage): void;
}
