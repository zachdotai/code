import { GitBranch, X } from "@phosphor-icons/react";
import { Button, Code, Flex, IconButton, Text } from "@radix-ui/themes";
import type { BranchMismatchBannerState } from "../workspace/useBranchMismatchBanner";

/**
 * Slim, non-blocking strip above the composer for a task whose working tree
 * is on a different branch than the task's linked branch. Sending is never
 * intercepted — the agent works on the current branch either way.
 */
export function BranchMismatchBanner({
  linkedBranch,
  currentBranch,
  actionError,
  isSwitching,
  isRelinking,
  onSwitch,
  onUseCurrentBranch,
  onDismiss,
}: BranchMismatchBannerState) {
  const busy = isSwitching || isRelinking;
  return (
    <Flex
      direction="column"
      gap="1"
      py="2"
      px="3"
      className="rounded-(--radius-3) border border-(--orange-6) bg-(--orange-2)"
    >
      <Flex align="center" justify="between" gap="3">
        <Flex align="center" gap="2" className="min-w-0">
          <GitBranch size={14} color="var(--orange-9)" className="shrink-0" />
          <Text className="truncate text-(--orange-12) text-[13px]">
            Task is linked to <Code variant="ghost">{linkedBranch}</Code> but
            you're on <Code variant="ghost">{currentBranch}</Code> — the agent
            works on the current branch.
          </Text>
        </Flex>
        <Flex align="center" gap="2" className="shrink-0">
          <Button
            size="1"
            variant="solid"
            onClick={onSwitch}
            loading={isSwitching}
            disabled={busy}
          >
            Switch branch
          </Button>
          <Button
            size="1"
            variant="soft"
            onClick={onUseCurrentBranch}
            loading={isRelinking}
            disabled={busy}
          >
            Use current branch
          </Button>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            aria-label="Dismiss"
            onClick={onDismiss}
          >
            <X size={12} />
          </IconButton>
        </Flex>
      </Flex>
      {actionError && (
        <Text color="red" className="text-[12px]">
          {actionError}
        </Text>
      )}
    </Flex>
  );
}
