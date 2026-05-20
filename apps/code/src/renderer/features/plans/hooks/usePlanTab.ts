import { usePanelLayoutStore } from "@features/panels/store/panelLayoutStore";
import { useEffect, useRef } from "react";
import { usePlanFilePath } from "./usePlanFilePath";

/**
 * Watches the session for plan file activity. When the agent writes a plan
 * file the Plan tab is registered (or its `filePath` is refreshed) and
 * brought to the front. Subsequent edits to the same path do nothing.
 */
export function usePlanTab(taskId: string | undefined): void {
  const planFilePath = usePlanFilePath(taskId ?? "");
  const ensurePlanTab = usePanelLayoutStore((s) => s.ensurePlanTab);
  const lastSeenPath = useRef<string | null>(null);

  useEffect(() => {
    if (!taskId || !planFilePath) return;
    if (lastSeenPath.current === planFilePath) return;
    lastSeenPath.current = planFilePath;
    ensurePlanTab(taskId, planFilePath);
  }, [taskId, planFilePath, ensurePlanTab]);
}
