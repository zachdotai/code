import type { z } from "zod";
import { logger } from "../../utils/logger";
import {
  type ActiveHoldState,
  type NestLoadout,
  nestLoadout,
  type scratchpadEntrySchema,
  scratchpadStateSchema,
} from "./schemas";

const schemaLog = logger.scope("hedgemony-schemas");

export interface HedgehogPersistedState {
  scratchpad: z.infer<typeof scratchpadEntrySchema>[];
  observedTerminalRunKeys: Record<string, string>;
  activeHold: ActiveHoldState | null;
}

/**
 * Loadouts live in `nests.loadoutJson` and are loaded back into the hedgehog
 * tick. We refuse to honour fields we can't validate (a tampered row could
 * otherwise set `executionMode: "bypassPermissions"` for every hoglet spawned
 * from that nest). The runtime may choose that mode as an internal autonomous
 * default, but not because a persisted row asked for it. We never throw — a
 * corrupt row falls back to defaults with a single warning so the operator can
 * keep working.
 */
export function parseNestLoadout(loadoutJson: string | null): NestLoadout {
  if (!loadoutJson) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(loadoutJson);
  } catch (error) {
    schemaLog.warn("nestLoadout JSON.parse failed; falling back to defaults", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
  const result = nestLoadout.safeParse(raw);
  if (!result.success) {
    schemaLog.warn("nestLoadout shape rejected; falling back to defaults", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    });
    return {};
  }
  return result.data;
}

export function parseHedgehogState(
  serializedStateJson: string | null,
): HedgehogPersistedState {
  if (!serializedStateJson) return emptyHedgehogState();
  let raw: unknown;
  try {
    raw = JSON.parse(serializedStateJson);
  } catch (error) {
    schemaLog.warn("scratchpad JSON.parse failed; starting fresh", {
      error: error instanceof Error ? error.message : String(error),
    });
    return emptyHedgehogState();
  }
  const result = scratchpadStateSchema.safeParse(raw);
  if (!result.success) {
    schemaLog.warn("scratchpad shape rejected; starting fresh", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path,
        code: issue.code,
      })),
    });
    return emptyHedgehogState();
  }
  return {
    scratchpad: result.data.scratchpad ?? [],
    observedTerminalRunKeys: result.data.observedTerminalRunKeys ?? {},
    activeHold: result.data.activeHold ?? null,
  };
}

function emptyHedgehogState(): HedgehogPersistedState {
  return { scratchpad: [], observedTerminalRunKeys: {}, activeHold: null };
}
