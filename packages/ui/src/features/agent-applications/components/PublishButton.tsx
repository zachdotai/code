import {
  Button as QuillButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@posthog/quill";
import type { AgentRevision } from "@posthog/shared/agent-platform-types";
import { Button } from "@posthog/ui/primitives/Button";
import { AlertDialog, Flex, Text } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { useAgentApplication } from "../hooks/useAgentApplication";
import { useAgentRevisionLifecycle } from "../hooks/useAgentRevisionLifecycle";
import { useAgentRevisions } from "../hooks/useAgentRevisions";

/**
 * Newest draft revision (by `updated_at`), or null if there is no draft. The
 * publish button targets this revision; freezing then promoting it is the
 * "ship the latest edits" gesture.
 */
export function findLatestDraft(
  revisions: AgentRevision[] | undefined | null,
): AgentRevision | null {
  if (!revisions) return null;
  return (
    [...revisions]
      .filter((r) => r.state === "draft")
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )[0] ?? null
  );
}

/**
 * One-click publish from the agent header: freezes the latest draft revision
 * and promotes it to live in sequence, behind a single confirm. The two-step
 * lifecycle still happens server-side; the user just doesn't see it.
 *
 * Hidden when the agent is archived. Disabled when there is no draft to ship.
 */
export function PublishButton({ idOrSlug }: { idOrSlug: string }) {
  const { data: application } = useAgentApplication(idOrSlug);
  const { data: revisions } = useAgentRevisions(idOrSlug);
  const lifecycle = useAgentRevisionLifecycle(idOrSlug);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = useMemo(() => findLatestDraft(revisions), [revisions]);

  if (!application || application.archived) return null;

  const hasDraft = !!draft;
  const tip = hasDraft
    ? "Freeze the draft and promote it to live"
    : "No draft to publish";

  async function handleConfirm() {
    if (!draft) return;
    setError(null);
    try {
      await lifecycle.mutateAsync({ revisionId: draft.id, action: "freeze" });
      await lifecycle.mutateAsync({ revisionId: draft.id, action: "promote" });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <QuillButton
              variant="primary"
              size="sm"
              disabled={!hasDraft}
              onClick={() => {
                setError(null);
                setOpen(true);
              }}
            >
              Publish
            </QuillButton>
          }
        />
        <TooltipContent side="top">{tip}</TooltipContent>
      </Tooltip>
      <AlertDialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!next && !lifecycle.isPending) {
            setOpen(false);
            setError(null);
          }
        }}
      >
        <AlertDialog.Content maxWidth="440px" size="2">
          <AlertDialog.Title className="text-base">
            Publish draft revision
          </AlertDialog.Title>
          <AlertDialog.Description size="2" className="text-gray-11">
            This freezes the current draft and promotes it to live. Triggers
            start serving from it immediately.
          </AlertDialog.Description>
          {error ? (
            <Text className="mt-2 block text-(--red-11) text-[12px]">
              {error}
            </Text>
          ) : null}
          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              disabled={lifecycle.isPending}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              color="green"
              loading={lifecycle.isPending}
              onClick={handleConfirm}
            >
              Publish
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
