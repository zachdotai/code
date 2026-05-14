import { useTRPC } from "@renderer/trpc";
import { useQuery } from "@tanstack/react-query";

export function useMemoryEntries() {
  const trpc = useTRPC();
  return useQuery(
    trpc.memory.list.queryOptions(undefined, { staleTime: 10_000 }),
  );
}

export function useMemoryEntry(relativePath: string | null) {
  const trpc = useTRPC();
  return useQuery(
    trpc.memory.get.queryOptions(
      { relativePath: relativePath ?? "" },
      { enabled: !!relativePath, staleTime: 5_000 },
    ),
  );
}

export function useMemoryGraph() {
  const trpc = useTRPC();
  return useQuery(
    trpc.memory.getGraph.queryOptions(undefined, { staleTime: 15_000 }),
  );
}

export function useMemoryRoot() {
  const trpc = useTRPC();
  return useQuery(
    trpc.memory.getRoot.queryOptions(undefined, { staleTime: 60_000 }),
  );
}
