import { sendPromptToAgent } from "@features/sessions/utils/sendPromptToAgent";
import { X } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Card, Flex } from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { isSendMessageSubmitKey } from "@utils/sendMessageKey";
import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePlanComposeStore } from "../stores/planComposeStore";
import { buildAskAgentToReplyToPlanThreadPrompt } from "../utils/planPrompts";

const log = logger.scope("plan-compose-popover");

const POPOVER_WIDTH = 360;
const GAP = 8;

export function PlanComposePopover() {
  const open = usePlanComposeStore((s) => s.open);
  const anchorRect = usePlanComposeStore((s) => s.anchorRect);
  const blockText = usePlanComposeStore((s) => s.blockText);
  const filePath = usePlanComposeStore((s) => s.filePath);
  const taskId = usePlanComposeStore((s) => s.taskId);
  const close = usePlanComposeStore((s) => s.close);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!cardRef.current) return;
      if (!cardRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    requestAnimationFrame(() => textareaRef.current?.focus());
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const handleSubmit = useCallback(async () => {
    const text = textareaRef.current?.value?.trim();
    if (!text || !filePath || !blockText || !taskId) return;
    try {
      await trpcClient.plans.appendThreadMessage.mutate({
        filePath,
        blockText,
        message: text,
        speaker: "H",
      });
      sendPromptToAgent(
        taskId,
        buildAskAgentToReplyToPlanThreadPrompt(filePath, blockText),
      );
    } catch (err) {
      log.warn("Failed to append plan thread", { err });
    } finally {
      close();
    }
  }, [filePath, blockText, taskId, close]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isSendMessageSubmitKey(e)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  if (!open || !anchorRect) return null;

  const viewportWidth = window.innerWidth;
  const preferredLeft = anchorRect.right + GAP;
  const fitsRight = preferredLeft + POPOVER_WIDTH + 8 <= viewportWidth;
  const left = fitsRight
    ? preferredLeft
    : Math.max(8, anchorRect.left - POPOVER_WIDTH - GAP);
  const top = Math.max(8, anchorRect.top);

  return createPortal(
    <div
      ref={cardRef}
      style={{
        position: "fixed",
        top,
        left,
        width: POPOVER_WIDTH,
        zIndex: 1000,
      }}
    >
      <Card size="2" className="shadow-lg">
        <textarea
          ref={textareaRef}
          placeholder="Add a comment to the plan…"
          onKeyDown={handleKeyDown}
          className="min-h-[80px] w-full resize-none rounded border border-(--gray-6) bg-(--color-background) p-2 text-(--gray-12) text-[13px] leading-normal outline-none"
        />
        <Flex align="center" gap="2" className="mt-2">
          <Button variant="primary" size="sm" onClick={handleSubmit}>
            Add comment
          </Button>
          <Button size="icon-sm" onClick={close}>
            <X />
          </Button>
        </Flex>
      </Card>
    </div>,
    document.body,
  );
}
