import { electronStorage } from "@utils/electronStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WorkThreadParticipantsState {
  /** taskId -> array of mentioned user uuids (insertion order, deduped). */
  participantsByTask: Record<string, string[]>;
}

interface WorkThreadParticipantsActions {
  addParticipants: (taskId: string, userUuids: string[]) => void;
  removeParticipant: (taskId: string, userUuid: string) => void;
  getParticipants: (taskId: string) => string[];
}

type WorkThreadParticipantsStore = WorkThreadParticipantsState &
  WorkThreadParticipantsActions;

export const useWorkThreadParticipantsStore =
  create<WorkThreadParticipantsStore>()(
    persist(
      (set, get) => ({
        participantsByTask: {},
        addParticipants: (taskId, userUuids) => {
          if (userUuids.length === 0) return;
          set((state) => {
            const existing = state.participantsByTask[taskId] ?? [];
            const merged = [...existing];
            for (const uuid of userUuids) {
              if (!merged.includes(uuid)) merged.push(uuid);
            }
            if (merged.length === existing.length) return state;
            return {
              participantsByTask: {
                ...state.participantsByTask,
                [taskId]: merged,
              },
            };
          });
        },
        removeParticipant: (taskId, userUuid) =>
          set((state) => {
            const existing = state.participantsByTask[taskId];
            if (!existing) return state;
            const filtered = existing.filter((id) => id !== userUuid);
            return {
              participantsByTask: {
                ...state.participantsByTask,
                [taskId]: filtered,
              },
            };
          }),
        getParticipants: (taskId) => get().participantsByTask[taskId] ?? [],
      }),
      {
        name: "work-thread-participants-storage",
        storage: electronStorage,
      },
    ),
  );
