import { McpServersView } from "@features/mcp-servers/components/McpServersView";
import { ArrowLeft } from "@phosphor-icons/react";
import { Button, Callout, Flex, Text } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import { useWorkStore } from "../stores/workStore";

/**
 * Wraps McpServersView for the Work mode data-sources screen. When the user
 * arrived here from a scheduled-task editor (a pending draft is on the work
 * store), show a banner with a one-click route back to the editor so the
 * in-progress draft isn't abandoned.
 */
export function WorkDataSourcesView() {
  const pendingCreateDraft = useWorkStore((s) => s.pendingCreateDraft);
  const pendingEditDraft = useWorkStore((s) => s.pendingEditDraft);
  const navigateToWorkScheduledCreate = useNavigationStore(
    (s) => s.navigateToWorkScheduledCreate,
  );
  const navigateToWorkScheduledEdit = useNavigationStore(
    (s) => s.navigateToWorkScheduledEdit,
  );

  const resumeTarget = pendingEditDraft
    ? () => navigateToWorkScheduledEdit(pendingEditDraft.id)
    : pendingCreateDraft
      ? () => navigateToWorkScheduledCreate()
      : null;

  return (
    <Flex direction="column" height="100%" className="overflow-hidden">
      {resumeTarget && (
        <Callout.Root
          size="1"
          color="blue"
          variant="surface"
          className="shrink-0 rounded-none border-(--gray-6) border-x-0 border-t-0"
        >
          <Flex align="center" justify="between" gap="3" className="w-full">
            <Callout.Text>
              <Text size="2">
                Setting up a data source for a scheduled task — your draft is
                saved.
              </Text>
            </Callout.Text>
            <Button size="1" variant="soft" onClick={resumeTarget}>
              <ArrowLeft size={12} />
              Back to scheduled task
            </Button>
          </Flex>
        </Callout.Root>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <McpServersView />
      </div>
    </Flex>
  );
}
