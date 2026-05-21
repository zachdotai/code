import { getPendingPermissionsForTask } from "@features/sessions/hooks/useSession";
import { getSessionService } from "@features/sessions/service/service";
import { Plus, X } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Flex, Tooltip } from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { isSendMessageSubmitKey } from "@utils/sendMessageKey";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildThreadKey,
  usePlanAgentActivityStore,
} from "../stores/planAgentActivityStore";
import { dispatchPlanComment } from "../utils/dispatchPlanComment";
import { buildAskAgentToReplyToPlanThreadPrompt } from "../utils/planPrompts";

const log = logger.scope("plan-block-gutter");

interface PlanBlockGutterProps {
  blockText: string | undefined;
  occurrence: number;
  filePath: string;
  taskId: string;
  children: ReactNode;
}

interface InlineComposerProps {
  blockText: string;
  occurrence: number;
  filePath: string;
  taskId: string;
  onClose: () => void;
}

function InlineComposer({
  blockText,
  occurrence,
  filePath,
  taskId,
  onClose,
}: InlineComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const enqueueAgentActivity = usePlanAgentActivityStore((s) => s.enqueue);
  const dequeueAgentActivity = usePlanAgentActivityStore((s) => s.dequeue);

  const handleSubmit = useCallback(async () => {
    const text = textareaRef.current?.value?.trim();
    if (!text) return;
    setPending(true);
    const threadKey = buildThreadKey({ filePath, blockText, occurrence });
    try {
      await trpcClient.plans.appendThreadMessage.mutate({
        filePath,
        blockText,
        occurrence,
        message: text,
        speaker: "H",
      });
      enqueueAgentActivity(threadKey);
      // Use dispatchPlanComment so the comment isn't silently queued
      // when ExitPlanMode is pending — see helper for the full
      // explanation. Await so we can dequeue on failure (offline,
      // disconnected session, etc.) — otherwise the "Responding…"
      // indicator sticks and the rejection is unhandled.
      try {
        const service = getSessionService();
        await dispatchPlanComment({
          taskId,
          pendingPermissions: getPendingPermissionsForTask(taskId),
          prompt: buildAskAgentToReplyToPlanThreadPrompt(filePath, blockText),
          sessionService: {
            respondToPermission: service.respondToPermission.bind(service),
            sendPrompt: service.sendPrompt.bind(service),
          },
        });
      } catch (sendErr) {
        log.warn("Failed to send plan-thread prompt", { err: sendErr });
        dequeueAgentActivity(threadKey);
      }
    } catch (err) {
      log.warn("Failed to append plan thread", { err });
    } finally {
      setPending(false);
      onClose();
    }
  }, [
    blockText,
    occurrence,
    filePath,
    taskId,
    onClose,
    enqueueAgentActivity,
    dequeueAgentActivity,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isSendMessageSubmitKey(e)) {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [handleSubmit, onClose],
  );

  return (
    <div className="my-2 ml-6">
      <div className="rounded-md border border-(--gray-5) bg-(--gray-2) p-2">
        <textarea
          ref={textareaRef}
          placeholder="Add a comment to the plan…"
          onKeyDown={handleKeyDown}
          className="min-h-[80px] w-full resize-none rounded border border-(--gray-6) bg-(--color-background) p-2 text-(--gray-12) text-[13px] leading-normal outline-none"
        />
        <Flex align="center" gap="2" className="mt-2">
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={pending}
          >
            {pending ? "Sending…" : "Add comment"}
          </Button>
          <Button size="sm" onClick={onClose}>
            <X />
          </Button>
        </Flex>
      </div>
    </div>
  );
}

/**
 * Wraps a markdown block (heading, paragraph, list) with a hover-revealed
 * `+` button in the left gutter. Clicking opens an inline composer
 * directly below the block — comments appear in the document flow, not
 * as a floating popover.
 */
export function PlanBlockGutter({
  blockText,
  occurrence,
  filePath,
  taskId,
  children,
}: PlanBlockGutterProps) {
  const [composing, setComposing] = useState(false);

  return (
    <>
      <div className="group relative">
        {blockText && (
          <Tooltip content="Add a comment" side="left">
            <button
              type="button"
              aria-label="Add a comment"
              onClick={() => setComposing(true)}
              className="-left-7 absolute top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-(--gray-5) bg-(--color-background) text-(--gray-11) opacity-0 transition-opacity hover:bg-(--gray-3) hover:text-(--gray-12) group-hover:opacity-100"
            >
              <Plus size={12} />
            </button>
          </Tooltip>
        )}
        {children}
      </div>
      {composing && blockText && (
        <InlineComposer
          blockText={blockText}
          occurrence={occurrence}
          filePath={filePath}
          taskId={taskId}
          onClose={() => setComposing(false)}
        />
      )}
    </>
  );
}
