import { usePanelLayoutStore } from "@features/panels/store/panelLayoutStore";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { useEffect, useRef } from "react";
import { usePlanFilePath } from "./usePlanFilePath";

/**
 * Watches the session for plan file activity. When the agent writes a plan
 * file the Plan tab is registered (or its `filePath` is refreshed) and
 * brought to the front. Subsequent edits to the same path do nothing.
 *
 * No-op when the `planThreadsEnabled` setting is off (the default). This
 * gates the entire feature: with no tab registration, `PlanView` never
 * mounts, the watcher is never started, and no gutter or compose UI is
 * surfaced.
 */
export function usePlanTab(taskId: string | undefined): void {
  const enabled = useSettingsStore((s) => s.planThreadsEnabled);
  const planFilePath = usePlanFilePath(taskId ?? "");
  const ensurePlanTab = usePanelLayoutStore((s) => s.ensurePlanTab);
  const lastSeenPath = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!taskId || !planFilePath) return;
    if (lastSeenPath.current === planFilePath) return;
    lastSeenPath.current = planFilePath;
    ensurePlanTab(taskId, planFilePath);
  }, [enabled, taskId, planFilePath, ensurePlanTab]);
}
