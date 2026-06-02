import { useTaskInputPrefillStore } from "@features/task-detail/stores/taskInputPrefillStore";
import { getCurrentMatches } from "@renderer/navigationBridge";
import type { Task } from "@shared/types";
import { useRouterState } from "@tanstack/react-router";
import { getCachedTask } from "@utils/queryClient";

export type AppViewType =
  | "task-detail"
  | "task-pending"
  | "task-input"
  | "folder-settings"
  | "inbox"
  | "archived"
  | "command-center"
  | "skills"
  | "mcp-servers"
  | "settings";

export interface TaskInputReportAssociation {
  reportId: string;
  title: string;
}

export interface AppView {
  type: AppViewType;
  data?: Task;
  taskId?: string;
  folderId?: string;
  pendingTaskKey?: string;
  taskInputRequestId?: string;
  initialPrompt?: string;
  initialCloudRepository?: string;
  initialModel?: string;
  initialMode?: string;
  reportAssociation?: TaskInputReportAssociation;
}

type Match = { routeId: string; params: Record<string, string | undefined> };

function deriveFromMatches(matches: Match[]): AppView {
  const last = matches[matches.length - 1];
  if (!last) return { type: "task-input" };

  switch (last.routeId) {
    case "/code/tasks/$taskId": {
      const taskId = last.params.taskId;
      if (!taskId) return { type: "task-input" };
      return { type: "task-detail", taskId, data: getCachedTask(taskId) };
    }
    case "/code/tasks/pending/$key":
      return { type: "task-pending", pendingTaskKey: last.params.key };
    case "/folders/$folderId":
      return { type: "folder-settings", folderId: last.params.folderId };
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
    case "/settings/$category":
    case "/settings/":
      return { type: "settings" };
    default:
      return { type: "task-input" };
  }
}

/**
 * Single source of truth for the current view. Replaces the
 * pre-router `useNavigationStore((s) => s.view)` pattern.
 */
export function useAppView(): AppView {
  const matches = useRouterState({
    select: (s) =>
      s.matches.map((m) => ({
        routeId: m.routeId,
        params: m.params as Record<string, string | undefined>,
      })),
  });
  const prefill = useTaskInputPrefillStore((s) => s.prefill);
  const view = deriveFromMatches(matches);

  // /code/ → merge prefill so the TaskInput screen surfaces transient fields.
  if (view.type === "task-input") {
    return {
      ...view,
      folderId: prefill.folderId,
      initialPrompt: prefill.initialPrompt,
      initialCloudRepository: prefill.initialCloudRepository,
      initialModel: prefill.initialModel,
      initialMode: prefill.initialMode,
      reportAssociation: prefill.reportAssociation,
      taskInputRequestId: prefill.requestId,
    };
  }
  return view;
}

/**
 * Read the current view outside React (event handlers, imperative code).
 * Components should prefer `useAppView()` for proper subscription.
 */
export function getAppViewSnapshot(): AppView {
  const matches = getCurrentMatches() as unknown as Match[];
  return deriveFromMatches(matches);
}
