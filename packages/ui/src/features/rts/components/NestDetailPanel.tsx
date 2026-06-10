import { useHostTRPCClient } from "@posthog/host-router/react";
import type { Nest } from "@posthog/host-router/rts-schemas";
import { logger } from "@posthog/ui/shell/logger";
import { Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import {
  selectNestHoglets,
  selectTaskSummary,
  useHogletStore,
} from "../stores/hogletStore";
import { useNestStore } from "../stores/nestStore";
import { deriveNestLifecycle } from "../utils/nestLifecycle";
import { CommandConsole } from "./CommandConsole";
import { CompactNestDialog } from "./CompactNestDialog";
import type { TaskStatus } from "./hogletStatus";
import { MarkValidatedDialog } from "./MarkValidatedDialog";
import { HogletsSection } from "./nest-detail/HogletsSection";
import { NestChatComposer } from "./nest-detail/NestChatComposer";
import { NestChatMessages } from "./nest-detail/NestChatMessages";
import { NestDetailFooter } from "./nest-detail/NestDetailFooter";
import { NestDetailHeader } from "./nest-detail/NestDetailHeader";
import { NestMetadataFields } from "./nest-detail/NestMetadataFields";
import { PrGraphSection } from "./nest-detail/PrGraphSection";
import { useNestChat } from "./nest-detail/useNestChat";
import { useNestMetadataEdit } from "./nest-detail/useNestMetadataEdit";
import { ValidationBanner } from "./nest-detail/ValidationBanner";
import { ReopenNestDialog } from "./ReopenNestDialog";

const log = logger.scope("nest-detail-panel");

interface NestDetailPanelProps {
  nest: Nest;
  onClose: () => void;
  onRelocate?: () => void;
  /**
   * Called when the user clicks a hoglet card inside the panel. Lets the
   * parent map view swap selection from this nest to the hoglet (which opens
   * the HogletDetailPanel and pans the camera to it).
   */
  onFocusHoglet?: (hogletId: string) => void;
}

export function NestDetailPanel({
  nest,
  onClose,
  onRelocate,
  onFocusHoglet,
}: NestDetailPanelProps) {
  const metadata = useNestMetadataEdit(nest);
  const chat = useNestChat(nest.id);

  const [archiving, setArchiving] = useState(false);
  const hostClient = useHostTRPCClient();
  const [validateDialogOpen, setValidateDialogOpen] = useState(false);
  const [compactDialogOpen, setCompactDialogOpen] = useState(false);
  const [reopenDialogOpen, setReopenDialogOpen] = useState(false);

  const hoglets = useHogletStore(selectNestHoglets(nest.id));
  const taskSummaries = useHogletStore((s) => s.taskSummaries);
  const lifecycle = useMemo(
    () =>
      deriveNestLifecycle({
        nest,
        hoglets,
        taskStatusFor: (taskId) =>
          (selectTaskSummary(taskId)({ taskSummaries } as never)?.latest_run
            ?.status as TaskStatus | null) ?? "not_started",
      }),
    [nest, hoglets, taskSummaries],
  );

  const editable = lifecycle === "planning" || lifecycle === "working";
  const showChatComposer = lifecycle !== "dormant" && lifecycle !== "archived";

  const validatedTaskIds = useMemo(
    () => hoglets.map((h) => h.taskId),
    [hoglets],
  );

  const validationDefaultSummary = useMemo(() => {
    const lines = [
      nest.definitionOfDone
        ? `Definition of done met: ${nest.definitionOfDone}`
        : "Goal satisfied.",
    ];
    if (hoglets.length > 0) {
      lines.push(`${hoglets.length} hoglet(s) completed their work.`);
    }
    return lines.join("\n\n");
  }, [nest.definitionOfDone, hoglets.length]);

  const handleArchive = async () => {
    if (archiving) return;
    setArchiving(true);
    metadata.setError(null);
    try {
      await hostClient.rts.nests.archive.mutate({
        id: nest.id,
      });
      useNestStore.getState().startDying(nest.id, nest.mapX, nest.mapY);
      onClose();
    } catch (e) {
      log.error("Failed to archive nest", { id: nest.id, error: e });
      metadata.setError(
        e instanceof Error ? e.message : "Failed to archive nest",
      );
      setArchiving(false);
    }
  };

  useHotkeys("s", () => void metadata.save(), [
    metadata.canSave,
    metadata.saving,
    archiving,
    metadata.name,
    metadata.goalPrompt,
    metadata.definitionOfDone,
  ]);
  useHotkeys("a", () => void handleArchive(), [metadata.saving, archiving]);
  useHotkeys("r", () => {
    if (onRelocate && !metadata.saving && !archiving) onRelocate();
  }, [onRelocate, metadata.saving, archiving]);

  const fieldsDisabled = metadata.saving || archiving || !editable;

  return (
    <CommandConsole
      consoleKey={nest.id}
      placement="right"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenuCapture={(e) => e.stopPropagation()}
    >
      <NestDetailHeader
        nestId={nest.id}
        title={nest.name}
        onClose={onClose}
        onRelocate={onRelocate}
        disabled={metadata.saving || archiving}
      />

      <ScrollArea
        type="auto"
        scrollbars="vertical"
        className="scroll-area-constrain-width min-h-0 flex-1"
      >
        <Flex direction="column" gap="4" px="4" py="3" className="min-w-0">
          <ValidationBanner
            lifecycle={lifecycle}
            onMarkValidated={() => setValidateDialogOpen(true)}
          />

          <NestMetadataFields
            name={metadata.name}
            onNameChange={metadata.setName}
            goalPrompt={metadata.goalPrompt}
            onGoalPromptChange={metadata.setGoalPrompt}
            definitionOfDone={metadata.definitionOfDone}
            onDefinitionOfDoneChange={metadata.setDefinitionOfDone}
            disabled={fieldsDisabled}
          />

          {metadata.error && (
            <Text size="2" color="red">
              {metadata.error}
            </Text>
          )}

          <HogletsSection
            nestId={nest.id}
            onFocusHoglet={onFocusHoglet}
            disabled={metadata.saving || archiving}
          />

          <PrGraphSection nestId={nest.id} />

          <NestChatMessages nestId={nest.id} />
        </Flex>
      </ScrollArea>

      {showChatComposer && (
        <NestChatComposer
          draft={chat.draft}
          onDraftChange={chat.setDraft}
          onSend={chat.send}
          onKeyDown={chat.handleKeyDown}
          sending={chat.sending}
          error={chat.error}
        />
      )}

      <NestDetailFooter
        lifecycle={lifecycle}
        editable={editable}
        canSave={metadata.canSave}
        saving={metadata.saving}
        archiving={archiving}
        onSave={() => void metadata.save()}
        onArchive={() => void handleArchive()}
        onOpenCompactDialog={() => setCompactDialogOpen(true)}
        onOpenReopenDialog={() => setReopenDialogOpen(true)}
      />

      <MarkValidatedDialog
        open={validateDialogOpen}
        onOpenChange={setValidateDialogOpen}
        nest={nest}
        defaultSummary={validationDefaultSummary}
        defaultPrUrls={[]}
        defaultTaskIds={validatedTaskIds}
        onValidated={(validated) => useNestStore.getState().upsert(validated)}
      />
      <CompactNestDialog
        open={compactDialogOpen}
        onOpenChange={setCompactDialogOpen}
        nest={nest}
        onCompacted={(compacted) => useNestStore.getState().upsert(compacted)}
      />
      <ReopenNestDialog
        open={reopenDialogOpen}
        onOpenChange={setReopenDialogOpen}
        nest={nest}
        onReopened={(reopened) => useNestStore.getState().upsert(reopened)}
      />
    </CommandConsole>
  );
}
