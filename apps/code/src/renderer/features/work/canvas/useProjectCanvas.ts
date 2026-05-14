import { trpcClient, useTRPC } from "@renderer/trpc";
import { toast } from "@renderer/utils/toast";
import type {
  GithubActivityType,
  GridSize,
  NewTileInput,
  TileSize,
  WorkProject,
} from "@shared/types/work-projects";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback } from "react";

/**
 * Canvas mutation hook with optimistic updates.
 *
 * Every mutation:
 * 1. Snapshots the current cached project.
 * 2. Applies the mutation to the cache synchronously (UI updates instantly).
 * 3. Fires the tRPC mutation.
 * 4. On error: rolls back to the snapshot and toasts.
 *
 * The subscription's `onData` is now a passive correctness backstop — the UI
 * already reflects the optimistic state by the time the server confirms.
 */

export function useWorkProjects() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const query = useQuery(trpc.workProjects.list.queryOptions());

  useSubscription(
    trpc.workProjects.onProjectsChanged.subscriptionOptions(undefined, {
      onData: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.workProjects.list.queryKey(),
        });
      },
    }),
  );

  return query;
}

export function useProjectCanvas(projectId: string | undefined) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const query = useQuery({
    ...trpc.workProjects.get.queryOptions({ projectId: projectId ?? "" }),
    enabled: !!projectId,
  });

  useSubscription(
    trpc.workProjects.onProjectChanged.subscriptionOptions(
      { projectId: projectId ?? "" },
      {
        enabled: !!projectId,
        onData: () => {
          if (!projectId) return;
          queryClient.invalidateQueries({
            queryKey: trpc.workProjects.get.queryKey({ projectId }),
          });
          queryClient.invalidateQueries({
            queryKey: trpc.workProjects.list.queryKey(),
          });
        },
      },
    ),
  );

  // The optimistic engine: snapshot → patch cache → call → rollback on error.
  const runOptimistic = useCallback(
    async (
      label: string,
      patch: (project: WorkProject) => WorkProject,
      call: () => Promise<unknown>,
    ): Promise<void> => {
      if (!projectId) return;
      const key = trpc.workProjects.get.queryKey({ projectId });
      const listKey = trpc.workProjects.list.queryKey();
      const prev = queryClient.getQueryData<WorkProject>(key);
      const prevList = queryClient.getQueryData<WorkProject[]>(listKey);

      if (prev) {
        const next = patch(prev);
        queryClient.setQueryData<WorkProject>(key, next);
        if (prevList) {
          queryClient.setQueryData<WorkProject[]>(
            listKey,
            prevList.map((p) => (p.id === projectId ? next : p)),
          );
        }
      }

      try {
        await call();
      } catch (err) {
        if (prev) queryClient.setQueryData<WorkProject>(key, prev);
        if (prevList)
          queryClient.setQueryData<WorkProject[]>(listKey, prevList);
        toast.error(`${label} failed`, {
          description: err instanceof Error ? err.message : "Please try again.",
        });
      }
    },
    [projectId, queryClient, trpc],
  );

  const addTile = useCallback(
    async (
      tile: NewTileInput,
      options: {
        state?: "live" | "pending_add";
        origin?: "user" | "chat";
      } = {},
    ): Promise<WorkProject | null> => {
      if (!projectId) return null;
      // We don't have a tile id locally until the server returns one, so just
      // fire the call and let the subscription update the cache. This is the
      // only mutation that creates server-assigned ids.
      try {
        return await trpcClient.workProjects.addTile.mutate({
          projectId,
          tile,
          state: options.state ?? "live",
          origin: options.origin ?? "user",
        });
      } catch (err) {
        toast.error("Add tile failed", {
          description: err instanceof Error ? err.message : "Please try again.",
        });
        return null;
      }
    },
    [projectId],
  );

  const removeTile = useCallback(
    (tileId: string): Promise<void> => {
      return runOptimistic(
        "Delete tile",
        (project) => ({
          ...project,
          tiles: project.tiles.filter((t) => t.id !== tileId),
        }),
        () =>
          trpcClient.workProjects.removeTile.mutate({
            projectId: projectId!,
            tileId,
          }),
      );
    },
    [projectId, runOptimistic],
  );

  const resizeTile = useCallback(
    (tileId: string, size: TileSize): Promise<void> => {
      return runOptimistic(
        "Resize tile",
        (project) => ({
          ...project,
          tiles: project.tiles.map((t) =>
            t.id === tileId ? ({ ...t, size } as typeof t) : t,
          ),
        }),
        () =>
          trpcClient.workProjects.resizeTile.mutate({
            projectId: projectId!,
            tileId,
            size,
          }),
      );
    },
    [projectId, runOptimistic],
  );

  const resizeTileGrid = useCallback(
    (tileId: string, nextGridSize: GridSize): Promise<void> => {
      return runOptimistic(
        "Resize tile",
        (project) => ({
          ...project,
          tiles: project.tiles.map((t) =>
            t.id === tileId
              ? ({ ...t, gridSize: nextGridSize } as typeof t)
              : t,
          ),
        }),
        () =>
          trpcClient.workProjects.resizeTileGrid.mutate({
            projectId: projectId!,
            tileId,
            gridSize: nextGridSize,
          }),
      );
    },
    [projectId, runOptimistic],
  );

  /** Batch-update layout (position + size) for many tiles at once. Called
   *  by the canvas grid after any drag or resize so the compactor's
   *  cascading neighbor shifts get persisted in a single round trip. */
  const updateTileLayout = useCallback(
    (
      items: Array<{
        tileId: string;
        cols: number;
        rows: number;
        x: number;
        y: number;
      }>,
    ): Promise<void> => {
      if (items.length === 0) return Promise.resolve();
      const byId = new Map(items.map((it) => [it.tileId, it]));
      return runOptimistic(
        "Update layout",
        (project) => ({
          ...project,
          tiles: project.tiles.map((t) => {
            const it = byId.get(t.id);
            if (!it) return t;
            return {
              ...t,
              gridSize: { cols: it.cols, rows: it.rows },
              gridPosition: { x: it.x, y: it.y },
            } as typeof t;
          }),
        }),
        () =>
          trpcClient.workProjects.updateTileLayout.mutate({
            projectId: projectId!,
            items,
          }),
      );
    },
    [projectId, runOptimistic],
  );

  const updateChecklistItems = useCallback(
    (
      tileId: string,
      items: Array<{ text: string; done: boolean }>,
    ): Promise<void> => {
      return runOptimistic(
        "Update checklist",
        (project) => ({
          ...project,
          tiles: project.tiles.map((t) => {
            if (t.id !== tileId) return t;
            if (t.type !== "artifact" || t.kind !== "checklist") return t;
            return { ...t, data: { ...t.data, items } } as typeof t;
          }),
        }),
        () =>
          trpcClient.workProjects.updateChecklistTile.mutate({
            projectId: projectId!,
            tileId,
            items,
          }),
      );
    },
    [projectId, runOptimistic],
  );

  const moveTile = useCallback(
    (tileId: string, toIndex: number): Promise<void> => {
      return runOptimistic(
        "Reorder tile",
        (project) => {
          const fromIndex = project.tiles.findIndex((t) => t.id === tileId);
          if (fromIndex < 0) return project;
          const clamped = Math.max(
            0,
            Math.min(toIndex, project.tiles.length - 1),
          );
          if (fromIndex === clamped) return project;
          const tiles = project.tiles.slice();
          const [moved] = tiles.splice(fromIndex, 1);
          tiles.splice(clamped, 0, moved);
          return { ...project, tiles };
        },
        () =>
          trpcClient.workProjects.moveTile.mutate({
            projectId: projectId!,
            tileId,
            toIndex,
          }),
      );
    },
    [projectId, runOptimistic],
  );

  const updateTitleTile = useCallback(
    (patch: {
      name?: string;
      tagline?: string;
      iconId?: WorkProject["iconId"];
    }): Promise<void> => {
      return runOptimistic(
        "Update project",
        (project) => {
          const tiles = project.tiles.map((t) => {
            if (t.type !== "title") return t;
            return {
              ...t,
              ...(patch.name !== undefined ? { name: patch.name } : {}),
              ...(patch.tagline !== undefined
                ? { tagline: patch.tagline }
                : {}),
              ...(patch.iconId !== undefined ? { iconId: patch.iconId } : {}),
            };
          });
          return {
            ...project,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.tagline !== undefined ? { tagline: patch.tagline } : {}),
            ...(patch.iconId !== undefined ? { iconId: patch.iconId } : {}),
            tiles,
          };
        },
        () =>
          trpcClient.workProjects.updateTitleTile.mutate({
            projectId: projectId!,
            ...patch,
          }),
      );
    },
    [projectId, runOptimistic],
  );

  const updateNoteTile = useCallback(
    (
      tileId: string,
      patch: {
        body?: string;
        tone?: "yellow" | "blue" | "green" | "pink" | "neutral";
      },
    ): Promise<void> => {
      return runOptimistic(
        "Update note",
        (project) => ({
          ...project,
          tiles: project.tiles.map((t) => {
            if (t.id !== tileId || t.type !== "note") return t;
            return {
              ...t,
              ...(patch.body !== undefined ? { body: patch.body } : {}),
              ...(patch.tone !== undefined ? { tone: patch.tone } : {}),
            };
          }),
        }),
        () =>
          trpcClient.workProjects.updateNoteTile.mutate({
            projectId: projectId!,
            tileId,
            ...patch,
          }),
      );
    },
    [projectId, runOptimistic],
  );

  const updateFileTile = useCallback(
    (
      tileId: string,
      patch: { filename?: string; contents?: string },
    ): Promise<void> => {
      return runOptimistic(
        "Update file",
        (project) => ({
          ...project,
          tiles: project.tiles.map((t) => {
            if (t.id !== tileId || t.type !== "file") return t;
            return {
              ...t,
              ...(patch.filename !== undefined
                ? { filename: patch.filename }
                : {}),
              ...(patch.contents !== undefined
                ? { contents: patch.contents }
                : {}),
            };
          }),
        }),
        () =>
          trpcClient.workProjects.updateFileTile.mutate({
            projectId: projectId!,
            tileId,
            ...patch,
          }),
      );
    },
    [projectId, runOptimistic],
  );

  const updateHeadlineTile = useCallback(
    (
      tileId: string,
      patch: {
        label?: string;
        liveLabel?: string;
        query?: { posthogProjectId: number; body: Record<string, unknown> };
        posthogUrl?: string;
        fallbackValue?: string;
        fallbackDelta?: string;
        fallbackSparkline?: number[];
      },
    ): Promise<void> => {
      return runOptimistic(
        "Update headline metric",
        (project) => ({
          ...project,
          tiles: project.tiles.map((t) => {
            if (t.id !== tileId || t.type !== "headline") return t;
            return {
              ...t,
              ...(patch.label !== undefined ? { label: patch.label } : {}),
              ...(patch.liveLabel !== undefined
                ? { liveLabel: patch.liveLabel }
                : {}),
              ...(patch.query !== undefined ? { query: patch.query } : {}),
              ...(patch.posthogUrl !== undefined
                ? { posthogUrl: patch.posthogUrl }
                : {}),
              ...(patch.fallbackValue !== undefined
                ? { fallbackValue: patch.fallbackValue }
                : {}),
              ...(patch.fallbackDelta !== undefined
                ? { fallbackDelta: patch.fallbackDelta }
                : {}),
              ...(patch.fallbackSparkline !== undefined
                ? { fallbackSparkline: patch.fallbackSparkline }
                : {}),
            };
          }),
        }),
        () =>
          trpcClient.workProjects.updateHeadlineTile.mutate({
            projectId: projectId!,
            tileId,
            ...patch,
          }),
      );
    },
    [projectId, runOptimistic],
  );

  const clearHeadlineTileQuery = useCallback(
    (tileId: string): Promise<void> => {
      return runOptimistic(
        "Clear headline metric",
        (project) => ({
          ...project,
          tiles: project.tiles.map((t) => {
            if (t.id !== tileId || t.type !== "headline") return t;
            const { query: _q, posthogUrl: _u, liveLabel: _l, ...rest } = t;
            return rest as typeof t;
          }),
        }),
        () =>
          trpcClient.workProjects.clearHeadlineTileQuery.mutate({
            projectId: projectId!,
            tileId,
          }),
      );
    },
    [projectId, runOptimistic],
  );

  const updateGithubActivityTile = useCallback(
    (
      tileId: string,
      patch: {
        repo?: { owner: string; name: string };
        enabledTypes?: GithubActivityType[];
        windowDays?: number;
      },
    ): Promise<void> => {
      return runOptimistic(
        "Update GitHub activity",
        (project) => ({
          ...project,
          tiles: project.tiles.map((t) => {
            if (t.id !== tileId || t.type !== "github_activity") return t;
            return {
              ...t,
              ...(patch.repo !== undefined ? { repo: patch.repo } : {}),
              ...(patch.enabledTypes !== undefined
                ? { enabledTypes: patch.enabledTypes }
                : {}),
              ...(patch.windowDays !== undefined
                ? { windowDays: patch.windowDays }
                : {}),
            };
          }),
        }),
        () =>
          trpcClient.workProjects.updateGithubActivityTile.mutate({
            projectId: projectId!,
            tileId,
            ...patch,
          }),
      );
    },
    [projectId, runOptimistic],
  );

  const refreshGithubActivityTile = useCallback(
    async (tileId: string): Promise<void> => {
      if (!projectId) return;
      try {
        await trpcClient.workProjects.refreshGithubActivityTile.mutate({
          projectId,
          tileId,
        });
      } catch (err) {
        toast.error("Refresh failed", {
          description: err instanceof Error ? err.message : "Please try again.",
        });
      }
    },
    [projectId],
  );

  const applyPending = useCallback(
    (tileId: string): Promise<void> => {
      return runOptimistic(
        "Accept tile",
        (project) => ({
          ...project,
          tiles: project.tiles
            .map((t) => {
              if (t.id !== tileId) return t;
              if (t.state === "pending_remove") return null;
              if (t.state === "pending_add" || t.state === "pending_edit") {
                return { ...t, state: "live" as const };
              }
              return t;
            })
            .filter((t): t is NonNullable<typeof t> => t !== null),
        }),
        () =>
          trpcClient.workProjects.applyPendingTile.mutate({
            projectId: projectId!,
            tileId,
          }),
      );
    },
    [projectId, runOptimistic],
  );

  const rejectPending = useCallback(
    (tileId: string): Promise<void> => {
      return runOptimistic(
        "Reject tile",
        (project) => ({
          ...project,
          tiles: project.tiles
            .map((t) => {
              if (t.id !== tileId) return t;
              if (t.state === "pending_add") return null;
              if (t.state === "pending_remove" || t.state === "pending_edit") {
                return { ...t, state: "live" as const };
              }
              return t;
            })
            .filter((t): t is NonNullable<typeof t> => t !== null),
        }),
        () =>
          trpcClient.workProjects.rejectPendingTile.mutate({
            projectId: projectId!,
            tileId,
          }),
      );
    },
    [projectId, runOptimistic],
  );

  return {
    project: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    addTile,
    removeTile,
    resizeTile,
    resizeTileGrid,
    updateTileLayout,
    moveTile,
    updateTitleTile,
    updateNoteTile,
    updateFileTile,
    updateChecklistItems,
    updateHeadlineTile,
    clearHeadlineTileQuery,
    updateGithubActivityTile,
    refreshGithubActivityTile,
    applyPending,
    rejectPending,
  };
}

export async function createProject(input: {
  name?: string;
  fromPrompt?: string;
}): Promise<WorkProject> {
  return await trpcClient.workProjects.create.mutate(input);
}

export async function createProjectFromTemplate(
  templateId: string,
): Promise<WorkProject> {
  return await trpcClient.workProjects.createFromTemplate.mutate({
    templateId,
  });
}
