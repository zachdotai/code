import { create } from "zustand";

interface PlanAgentActivityState {
  /**
   * FIFO list of thread keys the user has submitted to the agent and is
   * still waiting on a reply for. The head is whichever thread the agent
   * is actively working on (or about to — the agent processes the prompt
   * queue in order); the rest are queued behind it.
   */
  queue: string[];
  enqueue: (threadKey: string) => void;
  dequeue: (threadKey: string) => void;
  getStatus: (threadKey: string) => "active" | "queued" | null;
}

export const usePlanAgentActivityStore = create<PlanAgentActivityState>(
  (set, get) => ({
    queue: [],
    enqueue: (threadKey) =>
      set((state) => {
        if (state.queue.includes(threadKey)) return state;
        return { queue: [...state.queue, threadKey] };
      }),
    dequeue: (threadKey) =>
      set((state) => {
        if (!state.queue.includes(threadKey)) return state;
        return { queue: state.queue.filter((k) => k !== threadKey) };
      }),
    getStatus: (threadKey) => {
      const queue = get().queue;
      const idx = queue.indexOf(threadKey);
      if (idx === -1) return null;
      return idx === 0 ? "active" : "queued";
    },
  }),
);

export function buildThreadKey(args: {
  filePath: string;
  blockText: string;
  occurrence: number;
}): string {
  return `${args.filePath}::${args.blockText}::${args.occurrence}`;
}
