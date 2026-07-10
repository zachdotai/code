import { browserTabsStore } from "@posthog/core/browser-tabs/browserTabsStore";
import { activeTabIsBlank } from "@posthog/shared";
import { createSelectors } from "@posthog/ui/hooks/createSelectors";

const tabs = createSelectors(browserTabsStore);

/** Single store-selector: the live tab/pane/window snapshot mirrored from main. */
export function useTabsSnapshot() {
  return tabs.use.snapshot();
}

/**
 * True when the primary window's focused pane shows a blank "+" tab (no
 * canvas, task, or channel). The blank tab parks at `/website`, whose index
 * would otherwise redirect to the first channel — callers use this to suppress
 * that redirect so a blank tab (and the in-flight navigation leaving it) isn't
 * hijacked.
 */
export function useActiveTabIsBlank(): boolean {
  return activeTabIsBlank(useTabsSnapshot());
}

/** Per-pane variant of {@link useActiveTabIsBlank}: true when THIS pane's
 * active tab is a blank "+" tab. Each pane's chrome decides its own blank
 * placeholder — the window-focused pane is irrelevant to a background pane. */
export function usePaneActiveTabIsBlank(paneId: string): boolean {
  const snapshot = useTabsSnapshot();
  const pane = snapshot.panes.find((p) => p.id === paneId);
  const tab = pane?.activeTabId
    ? snapshot.tabs.find((t) => t.id === pane.activeTabId)
    : undefined;
  return (
    !!tab &&
    tab.dashboardId == null &&
    tab.taskId == null &&
    tab.channelId == null &&
    tab.appView == null
  );
}
