import type { Hoglet } from "@main/services/hedgemony/schemas";
import type { Schemas } from "@renderer/api/generated";

/**
 * Narrow interface over hoglet-bucket state used by mutations and
 * subscription orchestration. Zustand is one implementation; in-memory
 * fakes drive unit tests.
 */
export interface HogletRepository {
  findInBucket(bucket: string, hogletId: string): Hoglet | null;
  upsert(bucket: string, hoglet: Hoglet): void;
  remove(bucket: string, hogletId: string): void;
  setBucket(bucket: string, hoglets: Hoglet[]): void;
  startDying(hogletId: string, x: number, y: number): void;
  setTaskSummaries(summaries: Schemas.TaskSummary[]): void;
  collectTaskIds(): string[];
}
