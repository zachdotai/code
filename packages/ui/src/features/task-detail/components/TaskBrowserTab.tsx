import { BrowserPanel } from "@posthog/ui/features/browser/BrowserPanel";
import { useCallback } from "react";
import { usePanelLayoutStore } from "../../panels/panelLayoutStore";

interface TaskBrowserTabProps {
  url: string;
  tabId: string;
  taskId: string;
}

export function TaskBrowserTab({ url, tabId, taskId }: TaskBrowserTabProps) {
  const updateBrowserTabUrl = usePanelLayoutStore((s) => s.updateBrowserTabUrl);
  const updateTabLabel = usePanelLayoutStore((s) => s.updateTabLabel);

  const onUrlChange = useCallback(
    (next: string) => updateBrowserTabUrl(taskId, tabId, next),
    [updateBrowserTabUrl, taskId, tabId],
  );
  const onTitleChange = useCallback(
    (title: string) => updateTabLabel(taskId, tabId, title),
    [updateTabLabel, taskId, tabId],
  );

  return (
    <BrowserPanel
      url={url}
      onUrlChange={onUrlChange}
      onTitleChange={onTitleChange}
    />
  );
}
