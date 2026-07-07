import {
  type EditorContent,
  xmlToContent,
} from "@posthog/core/message-editor/content";
import {
  combineQueuedCloudPrompts,
  promptToQueuedEditorContent,
} from "@posthog/core/sessions/cloudPrompt";
import { useDraftStore } from "@posthog/ui/features/message-editor/draftStore";
import {
  type QueuedMessage,
  useSessionIsCloud,
} from "@posthog/ui/features/sessions/sessionStore";
import { useSessionViewActions } from "@posthog/ui/features/sessions/sessionViewStore";
import { useCallback } from "react";

/**
 * Empty editor content, used to clear the composer when an edit is cancelled.
 */
const EMPTY_CONTENT: EditorContent = { segments: [] };

/**
 * Load a queued message back into the composer for editing while keeping it in
 * the queue at its current position. Marks the message as the active edit
 * target so the composer's next submit updates it in place (see
 * `useSessionCallbacks.handleSendPrompt`) rather than sending a new prompt.
 *
 * Content restore mirrors the cancel-to-composer path: cloud keeps its rich
 * payload (mentions, attachments) via the queued-cloud conversion; local
 * restores the serialized text (chips reparse from the `<file .../>` tags).
 */
export function useEditQueuedMessage(
  taskId: string | undefined,
): (message: QueuedMessage) => void {
  const { requestFocus, setPendingContent } = useDraftStore((s) => s.actions);
  const { setEditingQueuedId } = useSessionViewActions();
  const isCloud = useSessionIsCloud(taskId);

  return useCallback(
    (message: QueuedMessage) => {
      if (!taskId) return;

      let pendingContent: EditorContent | null;
      if (isCloud) {
        const combined = combineQueuedCloudPrompts([message]);
        pendingContent = combined
          ? promptToQueuedEditorContent(combined)
          : null;
      } else {
        pendingContent = xmlToContent(message.content);
      }
      if (!pendingContent) return;

      setEditingQueuedId(taskId, message.id);
      setPendingContent(taskId, pendingContent);
      requestFocus(taskId);
    },
    [taskId, isCloud, requestFocus, setPendingContent, setEditingQueuedId],
  );
}

/**
 * Abandon an in-progress queued-message edit: drop the edit target so the next
 * submit sends normally again, and clear the composer so the abandoned draft
 * doesn't linger.
 */
export function useCancelQueuedMessageEdit(
  taskId: string | undefined,
): () => void {
  const { setPendingContent } = useDraftStore((s) => s.actions);
  const { clearEditingQueuedId } = useSessionViewActions();

  return useCallback(() => {
    if (!taskId) return;
    clearEditingQueuedId(taskId);
    setPendingContent(taskId, EMPTY_CONTENT);
  }, [taskId, clearEditingQueuedId, setPendingContent]);
}
