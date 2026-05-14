import { GitHubRepoPicker } from "@features/folder-picker/components/GitHubRepoPicker";
import type { TaskService } from "@features/task-detail/service/service";
import {
  useUserGithubRepositories,
  useUserRepositoryIntegration,
} from "@hooks/useIntegrations";
import { Button, Dialog, Flex, Text, TextArea } from "@radix-ui/themes";
import { get as getFromContainer } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import { trpcClient } from "@renderer/trpc/client";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { playSfx } from "../audio/sfx";
import { useHogletStore, WILD_BUCKET } from "../stores/hogletStore";

const log = logger.scope("spawn-hoglet-dialog");

export interface SpawnHogletDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SpawnHogletDialog({ open, onClose }: SpawnHogletDialogProps) {
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

  useEffect(() => {
    if (open) {
      setPrompt("");
      setSelectedRepository(null);
      setError(null);
      setSubmitting(false);
      setIsRepoPickerOpen(false);
      setRepoSearchQuery("");
    }
  }, [open]);

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
        playSfx("error");
        return;
      }

      const taskId = result.data.task.id;
      const hoglet = await trpcClient.hedgemony.hoglets.recordAdhoc.mutate({
        taskId,
      });

      useHogletStore.getState().upsert(WILD_BUCKET, hoglet);
      track(ANALYTICS_EVENTS.HEDGEMONY_HOGLET_SPAWNED, { source: "adhoc" });
      playSfx("spawn");
      onClose();
    } catch (e) {
      log.error("Failed to spawn wild hoglet", { error: e });
      setError(e instanceof Error ? e.message : "Failed to spawn hoglet");
      setSubmitting(false);
      playSfx("error");
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => !o && !submitting && onClose()}
    >
      <Dialog.Content
        maxWidth="480px"
        size="2"
        onPointerDownOutside={(e) => {
          const target = e.detail.originalEvent.target as HTMLElement | null;
          if (target?.closest("[data-quill-portal]")) {
            e.preventDefault();
          }
        }}
        onInteractOutside={(e) => {
          const target = e.detail.originalEvent.target as HTMLElement | null;
          if (target?.closest("[data-quill-portal]")) {
            e.preventDefault();
          }
        }}
      >
        <Dialog.Title size="3">Spawn an ad-hoc hoglet</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          Dispatch a one-off agent without picking a nest. It'll appear in the
          wild hoglet holding area.
        </Dialog.Description>

        <Flex direction="column" gap="3" mt="4">
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
              rows={5}
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

        <Flex gap="2" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={submitting}>
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            loading={submitting}
          >
            Spawn hoglet
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
