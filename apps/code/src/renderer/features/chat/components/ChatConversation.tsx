import { SessionView } from "@features/sessions/components/SessionView";
import { useSessionCallbacks } from "@features/sessions/hooks/useSessionCallbacks";
import { useSessionConnection } from "@features/sessions/hooks/useSessionConnection";
import { useSessionForTask } from "@features/sessions/stores/sessionStore";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import { ArrowLeft } from "@phosphor-icons/react";
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { useNavigationStore } from "@stores/navigationStore";
import { useMemo } from "react";
import { useChatDir } from "../hooks/useChatDir";
import { PromoteToCodeButton } from "./PromoteToCodeButton";
import { PromoteToWorkButton } from "./PromoteToWorkButton";

interface ChatConversationProps {
  chatId: string;
}

export function ChatConversation({ chatId }: ChatConversationProps) {
  const navigateToChatHome = useNavigationStore((s) => s.navigateToChatHome);
  const { data: tasks } = useTasks();
  const repoPath = useChatDir(chatId);

  const taskFromList = useMemo(
    () => tasks?.find((t) => t.id === chatId),
    [tasks, chatId],
  );

  const { data: taskFromApi } = useAuthenticatedQuery<Task>(
    ["tasks", "detail", chatId],
    (client) => client.getTask(chatId) as unknown as Promise<Task>,
    { enabled: !taskFromList },
  );

  const task = taskFromList ?? taskFromApi;

  const session = useSessionForTask(chatId);

  useSessionConnection({
    taskId: chatId,
    task: task ?? ({ id: chatId } as never),
    session,
    repoPath: repoPath ?? null,
    isCloud: false,
    isChat: true,
  });

  const {
    handleSendPrompt,
    handleCancelPrompt,
    handleRetry,
    handleNewSession,
    handleBashCommand,
  } = useSessionCallbacks({
    taskId: chatId,
    task: task ?? ({ id: chatId } as never),
    session,
    repoPath: repoPath ?? null,
  });

  if (!task) {
    return (
      <Flex align="center" justify="center" className="h-full w-full">
        <Text className="text-(--gray-11) text-[13px]">Loading chat…</Text>
      </Flex>
    );
  }

  const events = session?.events ?? [];
  const isPromptPending = session?.isPromptPending ?? false;
  const promptStartedAt = session?.promptStartedAt;
  const isRunning = session?.status === "connected";
  const hasError = session?.status === "error" && !session?.idleKilled;
  const isInitializing =
    !session ||
    (session.status === "connecting" && events.length === 0) ||
    (session.status === "connected" &&
      events.length === 0 &&
      (isPromptPending || !!task.latest_run?.id));

  return (
    <Flex direction="column" height="100%">
      <Flex
        align="center"
        justify="between"
        px="3"
        py="2"
        className="shrink-0 border-(--gray-6) border-b"
      >
        <Flex align="center" gap="2" className="min-w-0">
          <IconButton
            variant="ghost"
            size="1"
            onClick={navigateToChatHome}
            aria-label="Back to chat home"
          >
            <ArrowLeft size={14} />
          </IconButton>
          <Text
            as="div"
            weight="medium"
            className="truncate text-(--gray-12) text-[13px]"
          >
            {task.title || "Chat"}
          </Text>
        </Flex>
        <Flex align="center" gap="2" className="shrink-0">
          <PromoteToWorkButton taskId={chatId} />
          <PromoteToCodeButton taskId={chatId} />
        </Flex>
      </Flex>

      <Box flexGrow="1" overflow="hidden">
        <SessionView
          events={events}
          taskId={chatId}
          task={task}
          isRunning={isRunning}
          isPromptPending={isPromptPending}
          promptStartedAt={promptStartedAt}
          onSendPrompt={handleSendPrompt}
          onBashCommand={handleBashCommand}
          onCancelPrompt={handleCancelPrompt}
          repoPath={repoPath ?? undefined}
          hasError={hasError}
          errorTitle={session?.errorTitle}
          errorMessage={session?.errorMessage ?? undefined}
          onRetry={handleRetry}
          onNewSession={handleNewSession}
          isInitializing={isInitializing}
          isCloud={false}
          compact
          isActiveSession
        />
      </Box>
    </Flex>
  );
}
