import { GitHubRepoPicker } from "@features/folder-picker/components/GitHubRepoPicker";
import type { TaskService } from "@features/task-detail/service/service";
import {
  useUserGithubRepositories,
  useUserRepositoryIntegration,
} from "@hooks/useIntegrations";
import { X } from "@phosphor-icons/react";
import { Button, Flex, Text, TextArea } from "@radix-ui/themes";
import { get as getFromContainer } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import { trpcClient } from "@renderer/trpc/client";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { motion } from "framer-motion";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useHogletStore, WILD_BUCKET } from "../stores/hogletStore";

const log = logger.scope("spawn-hoglet-panel");

export interface SpawnHogletPanelProps {
  onClose: () => void;
}

export function SpawnHogletPanel({ onClose }: SpawnHogletPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedRepository, setSelectedRepository] = useState<string | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRepoPickerOpen, setIsRepoPickerOpen] = useState(false);
  const [repoSearchQuery, setRepoSearchQuery] = useState("");

  const {
    repositories,
    isLoadingRepos,
    isRefreshingRepos,
    refreshRepositories,
  } = useUserRepositoryIntegration();
  const {
    repositories: visibleCloudRepositories,
    isPending: cloudRepositoriesLoading,
    hasMore: cloudRepositoriesHasMore,
    loadMore: loadMoreCloudRepositories,
  } = useUserGithubRepositories(repoSearchQuery, isRepoPickerOpen);

  const handleRepositorySelect = useCallback((repo: string | null) => {
    setSelectedRepository(repo ? repo.toLowerCase() : null);
  }, []);

  const handleRepoPickerOpenChange = useCallback((nextOpen: boolean) => {
    setIsRepoPickerOpen(nextOpen);
    if (!nextOpen) {
      setRepoSearchQuery("");
    }
  }, []);

  const handleRefreshRepositories = useCallback(() => {
    void refreshRepositories().catch((e) => {
      toast.error("Failed to refresh repositories", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    });
  }, [refreshRepositories]);

  const trimmedPrompt = prompt.trim();
  const canSubmit =
    trimmedPrompt.length > 0 && selectedRepository !== null && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || submitting || !selectedRepository) return;
    setSubmitting(true);
    setError(null);
    try {
      const taskService = getFromContainer<TaskService>(
        RENDERER_TOKENS.TaskService,
      );
      const result = await taskService.createTask({
        content: trimmedPrompt,
        workspaceMode: "cloud",
        repository: selectedRepository,
        cloudPrAuthorshipMode: "bot",
        cloudRunSource: "manual",
      });

      if (!result.success) {
        const message = result.error ?? "Failed to spawn hoglet";
        log.error("Task creation failed", {
          failedStep: result.failedStep,
          error: result.error,
        });
        setError(message);
        setSubmitting(false);
        return;
      }

      const taskId = result.data.task.id;
      const hoglet = await trpcClient.hedgemony.hoglets.recordAdhoc.mutate({
        taskId,
      });

      useHogletStore.getState().upsert(WILD_BUCKET, hoglet);
      track(ANALYTICS_EVENTS.HEDGEMONY_HOGLET_SPAWNED, { source: "adhoc" });
      onClose();
    } catch (e) {
      log.error("Failed to spawn wild hoglet", { error: e });
      setError(e instanceof Error ? e.message : "Failed to spawn hoglet");
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!submitting) onClose();
  };

  return (
    <motion.aside
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="-translate-x-1/2 absolute bottom-3 left-1/2 z-10 flex max-h-[min(80%,560px)] w-[680px] min-w-0 max-w-[calc(100%-24px)] flex-col rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) shadow-xl"
    >
      <div className="flex items-start justify-between gap-3 border-(--gray-5) border-b px-4 py-3">
        <div className="min-w-0">
          <Text size="1" color="gray" className="block">
            Hedgehouse
          </Text>
          <Text size="3" weight="bold" className="block truncate">
            Send out a wild hog
          </Text>
          <Text size="1" color="gray" className="mt-0.5 block">
            Dispatched from the town hall of the wilds — lands in the holding
            area, no nest required.
          </Text>
        </div>
        <button
          type="button"
          onClick={handleClose}
          disabled={submitting}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-2) text-(--gray-10) hover:bg-(--gray-3) hover:text-(--gray-12) disabled:opacity-40"
          title="Close"
        >
          <X size={15} />
        </button>
      </div>

      <Flex
        direction="column"
        gap="3"
        p="4"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div>
          <Text
            as="label"
            htmlFor="hoglet-prompt"
            size="2"
            mb="1"
            weight="medium"
            className="block"
          >
            Prompt
          </Text>
          <TextArea
            id="hoglet-prompt"
            placeholder="Describe what this agent should do."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            autoFocus
            disabled={submitting}
          />
        </div>

        <div>
          <Text as="div" size="2" mb="1" weight="medium" className="block">
            Repository
          </Text>
          <GitHubRepoPicker
            value={selectedRepository}
            onChange={handleRepositorySelect}
            repositories={
              isRepoPickerOpen ? visibleCloudRepositories : repositories
            }
            isLoading={
              isLoadingRepos || (isRepoPickerOpen && cloudRepositoriesLoading)
            }
            isRefreshing={isRefreshingRepos}
            onRefresh={handleRefreshRepositories}
            open={isRepoPickerOpen}
            onOpenChange={handleRepoPickerOpenChange}
            searchQuery={repoSearchQuery}
            onSearchQueryChange={setRepoSearchQuery}
            hasMore={cloudRepositoriesHasMore}
            onLoadMore={loadMoreCloudRepositories}
            placeholder="Select repository..."
            size="2"
            disabled={submitting}
          />
        </div>

        {error && (
          <Text size="2" color="red">
            {error}
          </Text>
        )}
      </Flex>

      <Flex
        gap="2"
        px="4"
        py="3"
        justify="end"
        className="border-(--gray-5) border-t"
      >
        <Button
          variant="soft"
          color="gray"
          disabled={submitting}
          onClick={handleClose}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          loading={submitting}
        >
          Send wild hog
        </Button>
      </Flex>
    </motion.aside>
  );
}
