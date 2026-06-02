import { foldersApi } from "@features/folders/hooks/useFolders";
import { useTaskInputPrefillStore } from "@features/task-detail/stores/taskInputPrefillStore";
import { workspaceApi } from "@features/workspace/hooks/useWorkspace";
import { getTaskDirectory } from "@hooks/useRepositoryDirectory";
import * as nav from "@renderer/navigationBridge";
import type { Task } from "@shared/types";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { setActiveTaskAnalyticsContext, track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { getCachedTask, queryClient } from "@utils/queryClient";
import { getTaskRepository } from "@utils/repository";
import { create } from "zustand";

const log = logger.scope("navigation-store");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewType =
  | "task-detail"
  | "task-pending"
  | "task-input"
  | "folder-settings"
  | "inbox"
  | "archived"
  | "command-center"
  | "skills"
  | "mcp-servers";

export interface TaskInputReportAssociation {
  reportId: string;
  title: string;
}

export interface TaskInputNavigationOptions {
  folderId?: string;
  initialPrompt?: string;
  initialCloudRepository?: string;
  initialModel?: string;
  initialMode?: string;
  reportAssociation?: TaskInputReportAssociation;
}

interface ViewState {
  type: ViewType;
  data?: Task;
  taskId?: string;
  folderId?: string;
  taskInputRequestId?: string;
  initialPrompt?: string;
  initialCloudRepository?: string;
  initialModel?: string;
  initialMode?: string;
  reportAssociation?: TaskInputReportAssociation;
  pendingTaskKey?: string;
}

interface NavigationStore {
  view: ViewState;
  // history / historyIndex are router-owned now. Stubbed for back-compat.
  history: ViewState[];
  historyIndex: number;
  taskInputReportAssociation?: TaskInputReportAssociation;
  taskInputCloudRepository?: string;
  navigateToTask: (task: Task) => Promise<void>;
  navigateToPendingTask: (pendingTaskKey: string) => void;
  navigateToTaskInput: (
    folderIdOrOptions?: string | TaskInputNavigationOptions,
  ) => void;
  clearTaskInputReportAssociation: () => void;
  navigateToFolderSettings: (folderId: string) => void;
  navigateToInbox: () => void;
  navigateToArchived: () => void;
  navigateToCommandCenter: () => void;
  navigateToSkills: () => void;
  navigateToMcpServers: () => void;
  goBack: () => void;
  goForward: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  hydrateTask: (tasks: Task[]) => void;
}

// ---------------------------------------------------------------------------
// View derivation — pure function of router state + caches
// ---------------------------------------------------------------------------

function deriveView(): ViewState {
  const matches = nav.getCurrentMatches();
  const last = matches[matches.length - 1];
  if (!last) return { type: "task-input" };

  const prefill = useTaskInputPrefillStore.getState().prefill;

  switch (last.routeId) {
    case "/code/tasks/$taskId": {
      const taskId = (last.params as { taskId?: string }).taskId;
      if (!taskId) return { type: "task-input" };
      const data = getCachedTask(taskId);
      return { type: "task-detail", taskId, data };
    }
    case "/code/tasks/pending/$key": {
      const key = (last.params as { key?: string }).key;
      return { type: "task-pending", pendingTaskKey: key };
    }
    case "/folders/$folderId": {
      const folderId = (last.params as { folderId?: string }).folderId;
      return { type: "folder-settings", folderId };
    }
    case "/code/inbox":
      return { type: "inbox" };
    case "/code/archived":
      return { type: "archived" };
    case "/command-center":
      return { type: "command-center" };
    case "/skills":
      return { type: "skills" };
    case "/mcp-servers":
      return { type: "mcp-servers" };
    default:
      // /code/, /, or anything else → treat as task-input. Pull transient
      // prefill so the new-task screen restores prompt/folder/etc.
      return {
        type: "task-input",
        folderId: prefill.folderId,
        initialPrompt: prefill.initialPrompt,
        initialCloudRepository: prefill.initialCloudRepository,
        initialModel: prefill.initialModel,
        initialMode: prefill.initialMode,
        reportAssociation: prefill.reportAssociation,
        taskInputRequestId: prefill.requestId,
      };
  }
}

// ---------------------------------------------------------------------------
// Actions — call the navigation bridge; no internal state
// ---------------------------------------------------------------------------

async function navigateToTask(task: Task): Promise<void> {
  nav.navigateToTaskDetail(task.id);
  track(ANALYTICS_EVENTS.TASK_VIEWED, { task_id: task.id });

  const repoKey = getTaskRepository(task) ?? undefined;
  const existingWorkspace = await workspaceApi.get(task.id);

  if (existingWorkspace?.folderId) {
    const folders = await foldersApi.getFolders();
    const folder = folders.find((f) => f.id === existingWorkspace.folderId);

    if (folder && folder.exists === false) {
      log.info("Folder path is stale, redirecting to folder settings", {
        folderId: folder.id,
        path: folder.path,
      });
      nav.navigateToFolderSettings(folder.id);
      return;
    }
    if (folder) return;
  }

  const directory = await getTaskDirectory(task.id, repoKey ?? undefined);

  if (directory) {
    try {
      await foldersApi.addFolder(directory);
      const workspaceMode =
        task.latest_run?.environment === "cloud" ? "cloud" : "local";
      await workspaceApi.create({
        taskId: task.id,
        mainRepoPath: directory,
        folderId: "",
        folderPath: directory,
        mode: workspaceMode,
      });
    } catch (error) {
      log.error("Failed to auto-register folder on task open:", error);
    }
  } else if (task.latest_run?.environment === "cloud") {
    await workspaceApi.create({
      taskId: task.id,
      mainRepoPath: "",
      folderId: "",
      folderPath: "",
      mode: "cloud",
    });
  }
}

function navigateToTaskInput(
  folderIdOrOptions?: string | TaskInputNavigationOptions,
): void {
  const options =
    typeof folderIdOrOptions === "string"
      ? { folderId: folderIdOrOptions }
      : (folderIdOrOptions ?? {});

  const hasTransientState =
    !!options.initialPrompt ||
    !!options.initialCloudRepository ||
    !!options.initialModel ||
    !!options.initialMode ||
    !!options.reportAssociation;

  useTaskInputPrefillStore.setState({
    prefill: {
      folderId: options.folderId,
      initialPrompt: options.initialPrompt,
      initialCloudRepository: options.initialCloudRepository,
      initialModel: options.initialModel,
      initialMode: options.initialMode,
      reportAssociation: options.reportAssociation,
      requestId: hasTransientState
        ? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`)
        : undefined,
    },
  });
  nav.navigateToCode();
}

function clearTaskInputReportAssociation(): void {
  useTaskInputPrefillStore.getState().clearReportAssociation();
}

function navigateToCommandCenter(): void {
  nav.navigateToCommandCenter();
  track(ANALYTICS_EVENTS.COMMAND_CENTER_VIEWED);
}

// ---------------------------------------------------------------------------
// Snapshot — used by .getState() and per-render derivation
// ---------------------------------------------------------------------------

function getSnapshot(): NavigationStore {
  const view = deriveView();
  const prefill = useTaskInputPrefillStore.getState().prefill;

  return {
    view,
    history: [],
    historyIndex: 0,
    taskInputReportAssociation: prefill.reportAssociation,
    taskInputCloudRepository: prefill.initialCloudRepository,
    navigateToTask,
    navigateToPendingTask: nav.navigateToTaskPending,
    navigateToTaskInput,
    clearTaskInputReportAssociation,
    navigateToFolderSettings: nav.navigateToFolderSettings,
    navigateToInbox: nav.navigateToInbox,
    navigateToArchived: nav.navigateToArchived,
    navigateToCommandCenter,
    navigateToSkills: nav.navigateToSkills,
    navigateToMcpServers: nav.navigateToMcpServers,
    goBack: nav.goBackInHistory,
    goForward: nav.goForwardInHistory,
    canGoBack: () => true,
    canGoForward: () => true,
    hydrateTask: () => {
      /* No-op: the URL is the source of truth now. */
    },
  };
}

// ---------------------------------------------------------------------------
// Backing store — Zustand for selector memoization, but write-only from our
// own subscriptions to the router / prefill / task cache. Components never
// write to it directly (setState is a no-op for back-compat).
// ---------------------------------------------------------------------------

const baseStore = create<NavigationStore>(() => getSnapshot());

let refreshScheduled = false;
function refresh(): void {
  if (refreshScheduled) return;
  refreshScheduled = true;
  queueMicrotask(() => {
    refreshScheduled = false;
    baseStore.setState(getSnapshot(), true);
  });
}

// Trigger refresh on router navigations, prefill updates, and task cache
// changes (so view.data populates once useTasks resolves).
nav.subscribeToRouterResolved(() => {
  refresh();
  const view = deriveView();
  setActiveTaskAnalyticsContext(
    view.type === "task-detail" ? (view.data ?? null) : null,
  );
});
useTaskInputPrefillStore.subscribe(refresh);
queryClient.getQueryCache().subscribe((event) => {
  const key = event.query?.queryKey;
  if (Array.isArray(key) && key[0] === "tasks") refresh();
});

type Selector<T> = (state: NavigationStore) => T;

interface UseNavigationStore {
  <T = NavigationStore>(selector?: Selector<T>): T;
  getState: () => NavigationStore;
  /**
   * @deprecated View state derives from the router and is read-only. Use the
   * navigate* actions, or write to useTaskInputPrefillStore for transient
   * task-input prefill. Calls are ignored.
   */
  setState: (partial: Partial<NavigationStore>) => void;
}

function useNavigationStoreImpl<T = NavigationStore>(
  selector?: Selector<T>,
): T {
  if (selector) return baseStore(selector);
  return baseStore() as T;
}

export const useNavigationStore: UseNavigationStore = Object.assign(
  useNavigationStoreImpl,
  {
    getState: () => baseStore.getState(),
    setState: (_partial: Partial<NavigationStore>) => {
      log.warn(
        "useNavigationStore.setState is a no-op; view derives from the router.",
      );
    },
  },
);
