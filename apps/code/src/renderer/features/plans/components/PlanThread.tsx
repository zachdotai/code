import { MarkdownRenderer } from "@features/editor/components/MarkdownRenderer";
import { getPendingPermissionsForTask } from "@features/sessions/hooks/useSession";
import { getSessionService } from "@features/sessions/service/service";
import {
  CheckCircle,
  CircleNotch,
  Robot,
  User,
  X,
} from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Avatar, Badge, Box, Flex, Text } from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { isSendMessageSubmitKey } from "@utils/sendMessageKey";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildThreadKey,
  usePlanAgentActivityStore,
} from "../stores/planAgentActivityStore";
import { dispatchPlanComment } from "../utils/dispatchPlanComment";
import {
  buildAskAgentToIncorporateResolvedThreadPrompt,
  buildAskAgentToReplyToPlanThreadPrompt,
} from "../utils/planPrompts";

const log = logger.scope("plan-thread");

interface ParsedMessage {
  speaker: "H" | "A";
  text: string;
}

interface PlanThreadProps {
  filePath: string;
  taskId: string;
  blockText: string;
  occurrence: number;
  messages: ParsedMessage[];
  resolved: boolean;
}

function AgentActivityRow({
  status,
  resolved,
}: {
  status: "active" | "queued";
  resolved: boolean;
}) {
  const isActive = status === "active";
  const activeLabel = resolved ? "Incorporating feedback…" : "Responding…";
  return (
    <div className="flex gap-2">
      <div className="flex flex-col items-center">
        <div className="h-1.5 w-0.5 rounded-full bg-(--gray-5)" />
        <Avatar
          size="1"
          radius="full"
          fallback={<Robot size={12} />}
          className="shrink-0"
          color="blue"
        />
      </div>
      <div className="min-w-0 flex-1 pt-1 pb-1.5">
        <Flex align="center" gap="2" className="mb-0.5">
          <Text className="font-medium text-(--gray-12) text-[13px]">
            Agent
          </Text>
        </Flex>
        <Flex align="center" gap="1" className="text-(--gray-11) text-[13px]">
          {isActive ? (
            <>
              <CircleNotch
                size={12}
                className="animate-spin text-(--blue-11)"
              />
              <span>{activeLabel}</span>
            </>
          ) : (
            <>
              <CircleNotch size={12} className="text-(--gray-9)" />
              <span>Queued behind earlier comments</span>
            </>
          )}
        </Flex>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  showLineAbove,
  showLineBelow,
}: {
  message: ParsedMessage;
  showLineAbove: boolean;
  showLineBelow: boolean;
}) {
  const isAgent = message.speaker === "A";
  return (
    <div className="flex gap-2">
      <div className="flex flex-col items-center">
        {showLineAbove ? (
          <div className="h-1.5 w-0.5 rounded-full bg-(--gray-5)" />
        ) : (
          <div className="h-1.5" />
        )}
        <Avatar
          size="1"
          radius="full"
          fallback={isAgent ? <Robot size={12} /> : <User size={12} />}
          className="shrink-0"
          color={isAgent ? "blue" : "gray"}
        />
        {showLineBelow && (
          <div className="w-0.5 flex-1 rounded-full bg-(--gray-5)" />
        )}
      </div>
      <div className="min-w-0 flex-1 pt-1 pb-1.5">
        <Flex align="center" gap="2" className="mb-0.5">
          <Text className="font-medium text-(--gray-12) text-[13px]">
            {isAgent ? "Agent" : "You"}
          </Text>
        </Flex>
        <Box className="break-words text-(--gray-11) text-[13px] leading-relaxed [&_p]:m-0">
          <MarkdownRenderer content={message.text} />
        </Box>
      </div>
    </div>
  );
}

export function PlanThread({
  filePath,
  taskId,
  blockText,
  occurrence,
  messages,
  resolved,
}: PlanThreadProps) {
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const threadKey = useMemo(
    () => buildThreadKey({ filePath, blockText, occurrence }),
    [filePath, blockText, occurrence],
  );
  const activityStatus = usePlanAgentActivityStore((s) =>
    s.getStatus(threadKey),
  );
  const enqueueAgentActivity = usePlanAgentActivityStore((s) => s.enqueue);
  const dequeueAgentActivity = usePlanAgentActivityStore((s) => s.dequeue);

  // When the agent's reply lands (the thread's last non-resolved message
  // flips to `[A]:`), clear this thread from the activity queue so the
  // next queued thread is promoted to "active".
  const lastSpeaker = useMemo(
    () => (messages.length > 0 ? messages[messages.length - 1].speaker : null),
    [messages],
  );
  useEffect(() => {
    if (lastSpeaker === "A" && activityStatus !== null) {
      dequeueAgentActivity(threadKey);
    }
  }, [lastSpeaker, activityStatus, dequeueAgentActivity, threadKey]);

  // No unmount cleanup here. React StrictMode in dev double-invokes
  // effect cleanups (fake unmount → re-mount), which would race against
  // the user's just-submitted enqueue and clear the indicator before it
  // could render. The resolve-then-block-removed case is handled by
  // `extractThreadKeys` + `syncQueue` in `PlanView`, which sweeps the
  // queue whenever the plan content changes.

  const handleReplySubmit = useCallback(async () => {
    const text = textareaRef.current?.value?.trim();
    if (!text) return;
    setPending(text);
    setShowReplyBox(false);
    try {
      await trpcClient.plans.appendThreadMessage.mutate({
        filePath,
        blockText,
        occurrence,
        message: text,
        speaker: "H",
      });
      enqueueAgentActivity(threadKey);
      // Use dispatchPlanComment so the reply isn't silently queued when
      // ExitPlanMode is still pending. Await so we can dequeue on
      // failure — otherwise the indicator sticks.
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
        log.warn("Failed to send plan-thread reply prompt", { err: sendErr });
        dequeueAgentActivity(threadKey);
      }
    } catch (err) {
      log.warn("Failed to append plan thread reply", { err });
    } finally {
      setPending(null);
    }
  }, [
    blockText,
    occurrence,
    filePath,
    taskId,
    threadKey,
    enqueueAgentActivity,
    dequeueAgentActivity,
  ]);

  const handleResolve = useCallback(async () => {
    try {
      await trpcClient.plans.resolveThread.mutate({
        filePath,
        blockText,
        occurrence,
      });
      enqueueAgentActivity(threadKey);
      try {
        const service = getSessionService();
        await dispatchPlanComment({
          taskId,
          pendingPermissions: getPendingPermissionsForTask(taskId),
          prompt: buildAskAgentToIncorporateResolvedThreadPrompt(filePath),
          sessionService: {
            respondToPermission: service.respondToPermission.bind(service),
            sendPrompt: service.sendPrompt.bind(service),
          },
        });
      } catch (sendErr) {
        log.warn("Failed to send plan-resolve prompt", { err: sendErr });
        dequeueAgentActivity(threadKey);
      }
    } catch (err) {
      log.warn("Failed to resolve plan thread", { err });
    }
  }, [
    blockText,
    occurrence,
    filePath,
    taskId,
    threadKey,
    enqueueAgentActivity,
    dequeueAgentActivity,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isSendMessageSubmitKey(e)) {
        e.preventDefault();
        handleReplySubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowReplyBox(false);
      }
    },
    [handleReplySubmit],
  );

  const setTextareaRef = useCallback((el: HTMLTextAreaElement | null) => {
    textareaRef.current = el;
    if (el) requestAnimationFrame(() => el.focus());
  }, []);

  const renderedMessages = useMemo(() => messages, [messages]);

  return (
    <div className="my-2 ml-6">
      <div className="overflow-hidden rounded-md border border-(--gray-5) bg-(--gray-2) px-2.5 py-2 font-sans">
        {resolved && (
          <Flex align="center" gap="1" className="mb-1.5">
            <Badge color="green" size="1" variant="soft">
              <CheckCircle size={12} weight="fill" />
              Resolved
            </Badge>
          </Flex>
        )}

        {renderedMessages.map((message, index) => (
          <MessageRow
            key={`${message.speaker}-${index}`}
            message={message}
            showLineAbove={index > 0}
            showLineBelow={
              index < renderedMessages.length - 1 ||
              !!pending ||
              activityStatus !== null
            }
          />
        ))}

        {activityStatus !== null && (
          <AgentActivityRow status={activityStatus} resolved={resolved} />
        )}

        {pending && (
          <div className="flex gap-2 opacity-50">
            <div className="flex flex-col items-center">
              <div className="h-1.5 w-0.5 rounded-full bg-(--gray-5)" />
              <Avatar
                size="1"
                radius="full"
                fallback={<User size={12} />}
                className="shrink-0"
              />
            </div>
            <div className="min-w-0 flex-1 pt-1 pb-1.5">
              <Text className="font-medium text-(--gray-12) text-[13px]">
                Sending…
              </Text>
              <Box className="break-words text-(--gray-11) text-[13px] leading-relaxed [&_p]:m-0">
                <MarkdownRenderer content={pending} />
              </Box>
            </div>
          </div>
        )}

        {!resolved &&
          (showReplyBox ? (
            <div className="mt-1.5 border-(--gray-4) border-t pt-1.5">
              <textarea
                ref={setTextareaRef}
                placeholder="Write a reply…"
                onKeyDown={handleKeyDown}
                className="min-h-[48px] w-full resize-none rounded border border-(--gray-6) bg-(--color-background) p-1.5 text-(--gray-12) text-[13px] leading-normal outline-none"
              />
              <Flex align="center" gap="2" className="mt-1.5">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleReplySubmit}
                  disabled={!!pending}
                >
                  {pending ? "Sending…" : "Reply"}
                </Button>
                <Button size="icon-sm" onClick={() => setShowReplyBox(false)}>
                  <X />
                </Button>
              </Flex>
            </div>
          ) : (
            <Flex
              align="center"
              gap="1"
              className="mt-1 border-(--gray-4) border-t pt-1.5"
            >
              <Button size="sm" onClick={() => setShowReplyBox(true)}>
                Reply
              </Button>
              <Button size="sm" onClick={handleResolve}>
                <CheckCircle />
                Resolve
              </Button>
            </Flex>
          ))}
      </div>
    </div>
  );
}
