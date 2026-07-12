import { HashIcon } from "@phosphor-icons/react";
import { useHostTRPC } from "@posthog/host-router/react";
import {
  closeTab as closeTabLocal,
  closeTabs as closeTabsLocal,
  focusedPaneOfTab,
  newBlankTab as newBlankTabLocal,
  PROJECT_BLUEBIRD_FLAG,
  paneIdentityOf,
  primaryWindow,
  setTabOrder,
  setWindowActiveTab,
} from "@posthog/shared";
import { channelSectionFor } from "@posthog/ui/features/canvas/channelSections";
import { iconForTemplate } from "@posthog/ui/features/canvas/components/canvasTemplateIcon";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import {
  useDashboard,
  useDashboards,
} from "@posthog/ui/features/canvas/hooks/useDashboards";
import { SHORTCUTS } from "@posthog/ui/features/command/keyboard-shortcuts";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { usePanelLayoutStore } from "@posthog/ui/features/panels/panelLayoutStore";
import { getLeafPanel } from "@posthog/ui/features/panels/panelStoreHelpers";
import { useSidebarStore } from "@posthog/ui/features/sidebar/sidebarStore";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { createAppRouter } from "@posthog/ui/router/createAppRouter";
import { setPaneRouter } from "@posthog/ui/router/paneRouterRegistry";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { APP_VIEW_META, isAppView } from "./appViews";
import {
  frontOfUnpinnedOrder,
  partitionPinnedFirst,
  storedOrderIds,
} from "./displayOrder";
import { PaneLayoutGlyph } from "./PaneLayoutGlyph";
import { usePinnedTabsStore } from "./pinnedTabsStore";
import { TabStrip, type TabView } from "./TabStrip";
import { TaskTabIcon } from "./TaskTabIcon";
import { defaultBlankPaneHref } from "./tabHref";
import { useTabReorderStore } from "./tabReorderStore";
import { applyLocalTransform, persistWrite } from "./tabsSync";
import { useTabsSnapshot } from "./useBrowserTabs";

/**
 * Module-level caches of display info, keyed by id. Panes store only
 * references; names are resolved here as the user navigates (which loads each
 * channel's canvases/tasks), so cross-channel tabs still render a real label
 * without loading every channel up front.
 */
const canvasInfo = new Map<string, { name: string; templateId: string }>();
const taskInfo = new Map<string, string>();

/** Bounded insert (most-recent kept) so the caches don't grow unbounded over a
 * long session. */
const MAX_CACHE_ENTRIES = 200;
function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_CACHE_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

// True when the open task's focused editor panel has a closeable active tab.
// Cmd+W is inner-first: it closes that editor tab (handled by
// usePanelKeyboardShortcuts) before it closes the browser tab.
function taskHasCloseableEditorTab(taskId: string | null): boolean {
  if (!taskId) return false;
  const layout = usePanelLayoutStore.getState().getLayout(taskId);
  const panelId = layout?.focusedPanelId;
  if (!panelId || !layout?.panelTree) return false;
  const panel = getLeafPanel(layout.panelTree, panelId);
  const activeTab = panel?.content.tabs.find(
    (t) => t.id === panel.content.activeTabId,
  );
  return !!activeTab && activeTab.closeable !== false;
}

/**
 * The window's single tab strip (title bar). Each pill is a whole TAB — which
 * owns a pane layout; a multi-pane tab's pill carries a mini glyph of its
 * actual configuration. Selecting, closing, and creating tabs are pure store
 * mutations (local-first transforms + background persist): no router
 * navigation is involved, because pane routers keep their locations and the
 * pane tree simply renders the newly active tab. Labels and icons derive from
 * each tab's FOCUSED pane's identity.
 */
export function BrowserTabStrip() {
  const snapshot = useTabsSnapshot();
  const trpc = useHostTRPC();

  // Local-first sync (see tabsSync.ts): every operation applies its shared
  // pure transform to the mirror synchronously via applyLocalTransform, then
  // persists in the background via persistWrite. The mutations below are pure
  // transport — their returned snapshots are handled by persistWrite's
  // last-settle reconcile, never applied directly, so a stale echo can't
  // rewind the mirror mid-interaction.
  const newBlankTab = useMutation(
    trpc.browserTabs.newBlankTab.mutationOptions(),
  );
  const close = useMutation(trpc.browserTabs.close.mutationOptions());
  const closeMany = useMutation(trpc.browserTabs.closeMany.mutationOptions());
  const setOrder = useMutation(trpc.browserTabs.setOrder.mutationOptions());
  const setActiveTab = useMutation(
    trpc.browserTabs.setActiveTab.mutationOptions(),
  );

  const pinnedTabIds = usePinnedTabsStore((s) => s.pinnedTabIds);
  const togglePinned = usePinnedTabsStore((s) => s.togglePinned);
  const prunePinned = usePinnedTabsStore((s) => s.prune);
  // Transient reorder preview (set while a pill is dragged); overrides the
  // strip's order without touching the domain snapshot mirror.
  const previewOrder = useTabReorderStore((s) => s.previewOrder);
  // Drop pins for tabs that no longer exist (closed here or in another
  // window). Skip the pre-seed empty snapshot so a slow boot doesn't wipe pins.
  useEffect(() => {
    if (snapshot.windows.length === 0) return;
    prunePinned(snapshot.tabs.map((t) => t.id));
  }, [snapshot, prunePinned]);

  // Whether the channels surface is live — the same gate the sidebar uses.
  // This (not the current route) decides a new tab's default landing and
  // whether Cmd+1-9 switches browser tabs rather than sidebar tasks.
  const bluebirdEnabled = useFeatureFlag(
    PROJECT_BLUEBIRD_FLAG,
    import.meta.env.DEV,
  );
  const channelsEnabled =
    useSidebarStore((s) => s.channelsEnabled) && bluebirdEnabled;
  const win = primaryWindow(snapshot);
  const windowId = win?.id;
  const activeTabId = win?.activeTabId ?? null;
  const activeTab = activeTabId
    ? snapshot.tabs.find((t) => t.id === activeTabId)
    : undefined;
  const activeIdentity = activeTab
    ? (() => {
        const pane = focusedPaneOfTab(snapshot, activeTab);
        return pane ? paneIdentityOf(pane) : null;
      })()
    : null;

  // Names feed the tab labels. The channel canvas list + all-tasks list cover
  // most tabs; a direct fetch of the *active pane's* canvas/task (warm cache
  // from the detail page) makes the focused tab's name update the instant its
  // pane navigates. Only poll the all-tasks list when a task pane actually
  // needs a title.
  const hasTaskPane = snapshot.panes.some((p) => p.taskId != null);
  const { channels } = useChannels();
  const { dashboards } = useDashboards(activeIdentity?.channelId ?? undefined);
  const { dashboard: activeRecord } = useDashboard(
    activeIdentity?.dashboardId ?? undefined,
  );
  const { data: allTasks } = useTasks(undefined, { enabled: hasTaskPane });
  const { data: activeTaskRecord } = useQuery({
    ...taskDetailQuery(activeIdentity?.taskId ?? ""),
    enabled: !!activeIdentity?.taskId,
  });
  // Remember names so a background tab from another channel keeps its label
  // after its channel's list unloads. Written in an effect (not during render)
  // to keep render pure; the tabs memo reads the live lists first anyway.
  useEffect(() => {
    for (const d of dashboards) {
      remember(canvasInfo, d.id, { name: d.name, templateId: d.templateId });
    }
    if (activeRecord) {
      remember(canvasInfo, activeRecord.id, {
        name: activeRecord.name,
        templateId: activeRecord.templateId,
      });
    }
    for (const t of allTasks ?? []) remember(taskInfo, t.id, t.title);
    if (activeTaskRecord) {
      remember(taskInfo, activeTaskRecord.id, activeTaskRecord.title);
    }
  }, [dashboards, activeRecord, allTasks, activeTaskRecord]);

  const channelName = useMemo(() => {
    const map = new Map(channels.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (map.get(id) ?? null) : null);
  }, [channels]);

  const tabs: TabView[] = useMemo(() => {
    if (!windowId) return [];
    // Reference the reactive sources directly so labels recompute the instant a
    // name resolves — not just when the snapshot changes.
    const resolveCanvas = (id: string) => {
      if (activeRecord?.id === id) {
        return { name: activeRecord.name, templateId: activeRecord.templateId };
      }
      const fromList = dashboards.find((d) => d.id === id);
      if (fromList) {
        return { name: fromList.name, templateId: fromList.templateId };
      }
      return canvasInfo.get(id);
    };
    const findTask = (id: string) =>
      activeTaskRecord?.id === id
        ? activeTaskRecord
        : allTasks?.find((t) => t.id === id);

    const pinnedSet = new Set(pinnedTabIds);
    const byId = new Map(snapshot.tabs.map((t) => [t.id, t]));
    // Base stored order — during a drag, the transient preview order overrides
    // it (filtered to live tabs; any tab not in the preview is appended in
    // stored order). The pinned-first partition is applied on top.
    const stored = storedOrderIds(snapshot, windowId);
    let base = stored;
    if (previewOrder) {
      const live = new Set(stored);
      const seen = new Set(previewOrder);
      base = [
        ...previewOrder.filter((id) => live.has(id)),
        ...stored.filter((id) => !seen.has(id)),
      ];
    }
    return partitionPinnedFirst(base, pinnedTabIds)
      .map((id) => byId.get(id))
      .filter((t) => t !== undefined)
      .map((t): TabView => {
        const pinned = pinnedSet.has(t.id);
        // The pill shows the FOCUSED pane's identity; a multi-pane tab swaps
        // the content icon for a glyph of its actual layout.
        const pane = focusedPaneOfTab(snapshot, t);
        const identity = pane ? paneIdentityOf(pane) : null;
        const glyph =
          t.layout.type === "split" ? (
            <PaneLayoutGlyph key={t.id} layout={t.layout} />
          ) : null;
        const channel = channelName(identity?.channelId ?? null);
        if (identity?.taskId) {
          const task = findTask(identity.taskId);
          return {
            id: t.id,
            label: task?.title ?? taskInfo.get(identity.taskId) ?? "Task",
            icon: glyph ?? <TaskTabIcon task={task} size={14} />,
            channelName: channel,
            pinned,
          };
        }
        if (identity?.dashboardId) {
          const info = resolveCanvas(identity.dashboardId);
          return {
            id: t.id,
            label: info?.name ?? "Canvas",
            icon:
              glyph ??
              iconForTemplate(info?.templateId ?? "freeform", { size: 14 }),
            channelName: channel,
            pinned,
          };
        }
        // A channel tab: a sub-section (Artifacts/Recents/…) or the channel home.
        // The section drives the label; the channel name carries the `#` hover
        // context. Home has no section, so it labels by the channel name.
        if (identity?.channelId) {
          const meta = channelSectionFor(identity.channelSection);
          return {
            id: t.id,
            label: meta?.label ?? channel ?? "Channel",
            icon: glyph ?? <HashIcon size={14} />,
            channelName: channel,
            // No section meta → the channel's index page.
            isChannelHome: !meta,
            pinned,
          };
        }
        // A top-level app page (Inbox, Agents, Skills, …).
        if (identity?.appView && isAppView(identity.appView)) {
          return {
            id: t.id,
            label: APP_VIEW_META[identity.appView].label,
            icon: glyph ?? APP_VIEW_META[identity.appView].icon,
            channelName: null,
            pinned,
          };
        }
        return {
          id: t.id,
          label: "New tab",
          icon: glyph ?? undefined,
          channelName: null,
          pinned,
        };
      });
  }, [
    snapshot,
    windowId,
    pinnedTabIds,
    previewOrder,
    channelName,
    dashboards,
    activeRecord,
    allTasks,
    activeTaskRecord,
  ]);

  // A tab switch is a pure store mutation: the pane tree renders the newly
  // active tab, whose pane routers kept their locations. No history entry is
  // written (browser-like — back/forward stay within a pane).
  const handleSelect = (tabId: string) => {
    if (!windowId || tabId === activeTabId) return;
    applyLocalTransform((s) => setWindowActiveTab(s, windowId, tabId));
    void persistWrite(() => setActiveTab.mutateAsync({ windowId, tabId }));
  };

  // Closing needs no navigation either: succession (or the blank backfill on
  // the last tab) is decided inside the transform, and the pane tree follows
  // the snapshot. The blank-backfill ids are minted here so the local apply
  // and the persisted state agree.
  const handleClose = (tabId: string) => {
    const blankTabId = crypto.randomUUID();
    const blankPaneId = crypto.randomUUID();
    applyLocalTransform(
      (s) =>
        closeTabLocal(s, tabId, {
          makeId: () => crypto.randomUUID(),
          now: Date.now,
          blankTabId,
          blankPaneId,
        }).snapshot,
    );
    void persistWrite(() =>
      close.mutateAsync({ tabId, blankTabId, blankPaneId }),
    );
  };

  // Unpinning re-homes the tab at the front of the unpinned block. Apply the
  // reorder optimistically (in the same tick as the pin toggle) so the tab
  // doesn't visibly jump from its stored slot to the front a round-trip later.
  const handleTogglePin = (tabId: string) => {
    const wasPinned = pinnedTabIds.includes(tabId);
    togglePinned(tabId);
    if (!wasPinned || !windowId) return;
    const order = frontOfUnpinnedOrder(snapshot, windowId, tabId, pinnedTabIds);
    applyLocalTransform((s) => setTabOrder(s, windowId, order));
    void persistWrite(() => setOrder.mutateAsync({ windowId, tabIds: order }));
  };

  // Bulk closes operate on the strip's *displayed* order (pinned-first) and
  // never take pinned tabs with them. The anchor (the right-clicked tab, which
  // always survives) takes focus if the active tab was among those closed.
  const handleCloseMany = (tabIds: string[], anchorTabId: string) => {
    if (tabIds.length === 0) return;
    applyLocalTransform((s) =>
      closeTabsLocal(s, tabIds, anchorTabId, {
        makeId: () => crypto.randomUUID(),
        now: Date.now,
      }),
    );
    void persistWrite(() =>
      closeMany.mutateAsync({ tabIds, focusTabId: anchorTabId }),
    );
  };

  const handleCloseOthers = (tabId: string) => {
    handleCloseMany(
      tabs.filter((t) => t.id !== tabId && !t.pinned).map((t) => t.id),
      tabId,
    );
  };

  const handleCloseToRight = (tabId: string) => {
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    handleCloseMany(
      tabs
        .slice(idx + 1)
        .filter((t) => !t.pinned)
        .map((t) => t.id),
      tabId,
    );
  };

  const handleCloseToLeft = (tabId: string) => {
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    handleCloseMany(
      tabs
        .slice(0, idx)
        .filter((t) => !t.pinned)
        .map((t) => t.id),
      tabId,
    );
  };

  // New tab is fully local: mint the ids here, append the blank tab to the
  // mirror, pre-seed its pane's router at the default landing (the /website
  // new-tab page with channels on, the Code new-task screen otherwise), then
  // persist with the same ids. The service is idempotent on the minted tab
  // id, so a replay can't append a duplicate.
  const handleNewTab = () => {
    if (!windowId) return;
    const tabId = crypto.randomUUID();
    const paneId = crypto.randomUUID();
    applyLocalTransform(
      (s) =>
        newBlankTabLocal(s, {
          windowId,
          tabId,
          paneId,
          makeId: () => crypto.randomUUID(),
          now: Date.now,
        }).snapshot,
    );
    const router = createAppRouter({
      paneId,
      initialHref: defaultBlankPaneHref(channelsEnabled),
    });
    setPaneRouter(paneId, router);
    void router.load().catch(() => undefined);
    void persistWrite(() =>
      newBlankTab.mutateAsync({ windowId, tabId, paneId }),
    );
  };

  // Cmd/Ctrl+T opens a new browser tab. Bound here (not globally) so it only
  // fires where the strip is mounted; the new-task shortcut owns Cmd/Ctrl+N.
  useHotkeys(
    SHORTCUTS.NEW_TAB,
    (e) => {
      e.preventDefault();
      handleNewTab();
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  // Cmd/Ctrl+W closes the active browser tab. Always preventDefault so Electron
  // doesn't close the window, but defer to the task's editor panel when it has a
  // closeable tab (inner-first) — that handler closes the editor tab instead.
  useHotkeys(
    SHORTCUTS.CLOSE_TAB,
    (e) => {
      e.preventDefault();
      if (taskHasCloseableEditorTab(activeIdentity?.taskId ?? null)) return;
      if (activeTabId) handleClose(activeTabId);
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  // With channels on, Cmd/Ctrl+1-9 switches to the Nth browser tab (in the
  // displayed, pinned-first order) instead of the Nth sidebar task. The global
  // task-switch handler yields via the same channelsEnabled gate, so exactly one
  // owner fires. Mirror its pure-ctrl guard: ctrl+1-9 is the editor-panel tab
  // switcher (SWITCH_TAB), so leave ctrl-only presses to it.
  useHotkeys(
    SHORTCUTS.SWITCH_TASK,
    (event, handler) => {
      if (event.ctrlKey && !event.metaKey) return;
      const key = handler.keys?.[0];
      if (!key) return;
      const tab = tabs[Number.parseInt(key, 10) - 1];
      if (tab) handleSelect(tab.id);
    },
    {
      enableOnFormTags: true,
      enableOnContentEditable: true,
      preventDefault: true,
      enabled: channelsEnabled,
    },
    [tabs, handleSelect],
  );

  return (
    <TabStrip
      tabs={tabs}
      activeTabId={activeTabId}
      onSelect={handleSelect}
      onClose={handleClose}
      onTogglePin={handleTogglePin}
      onCloseOthers={handleCloseOthers}
      onCloseToRight={handleCloseToRight}
      onCloseToLeft={handleCloseToLeft}
      onNewTab={handleNewTab}
    />
  );
}
