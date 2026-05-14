import { useTRPC } from "@renderer/trpc";
import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useMemoryStore } from "../stores/memoryStore";

export function useMemoryWatcher() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const markTouched = useMemoryStore((s) => s.markTouched);

  useSubscription(
    trpc.memory.onChanged.subscriptionOptions(undefined, {
      onData: (event) => {
        queryClient.invalidateQueries({ queryKey: ["memory"] });
        if (event.changeType !== "deleted") {
          markTouched(event.relativePath);
        }
      },
    }),
  );
}
