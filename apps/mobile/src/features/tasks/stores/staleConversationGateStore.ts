import { create } from "zustand";

interface StaleConversationGateState {
  /**
   * Tasks where the gate engaged, keyed to the last-activity time observed at
   * that moment (null when none was observed). Latched: reconnecting to a stale
   * task immediately appends freshly-stamped events (usage updates, handshakes)
   * that would otherwise make the conversation look active again and dismiss
   * the warning before the user has chosen.
   */
  engagedSessions: Map<string, number | null>;
  /** Tasks where the user accepted the "large + idle = costly" warning. */
  acknowledgedSessions: Set<string>;
}

interface StaleConversationGateActions {
  engage: (taskId: string, lastActivityAt: number | null) => void;
  acknowledge: (taskId: string) => void;
}

export type StaleConversationGateStore = StaleConversationGateState &
  StaleConversationGateActions;

/**
 * Ephemeral (not persisted) view state: both maps only need to last for the
 * current app run.
 */
export const useStaleConversationGateStore =
  create<StaleConversationGateStore>()((set) => ({
    engagedSessions: new Map(),
    acknowledgedSessions: new Set(),

    engage: (taskId, lastActivityAt) =>
      set((state) => {
        if (
          state.engagedSessions.has(taskId) ||
          state.acknowledgedSessions.has(taskId)
        ) {
          return state;
        }
        const next = new Map(state.engagedSessions);
        next.set(taskId, lastActivityAt);
        return { engagedSessions: next };
      }),

    acknowledge: (taskId) =>
      set((state) => {
        if (state.acknowledgedSessions.has(taskId)) return state;
        const nextAcknowledged = new Set(state.acknowledgedSessions);
        nextAcknowledged.add(taskId);
        if (!state.engagedSessions.has(taskId)) {
          return { acknowledgedSessions: nextAcknowledged };
        }
        const nextEngaged = new Map(state.engagedSessions);
        nextEngaged.delete(taskId);
        return {
          acknowledgedSessions: nextAcknowledged,
          engagedSessions: nextEngaged,
        };
      }),
  }));
