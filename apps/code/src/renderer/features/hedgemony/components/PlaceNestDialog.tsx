import type {
  GoalDraftTranscriptMessage,
  GoalSpecBootstrapContext,
  GoalSpecDraft,
  Nest,
} from "@main/services/hedgemony/schemas";
import {
  Button,
  Callout,
  Dialog,
  Flex,
  ScrollArea,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import type { ReactNode } from "react";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  buildSimpleTranscript,
  initialPlaceNestDialogState,
  type NestCreationMode,
  placeNestDialogReducer,
  suggestName,
} from "./placeNestDialogReducer";

const log = logger.scope("place-nest-dialog");

const DRAFTING_STATUS_WORDS = [
  "Sniffing out scope",
  "Gathering twigs",
  "Sorting sharp edges",
  "Lining the nest",
  "Checking the done-ness",
  "Shaping the goal",
];

export type { NestCreationMode };

export interface PlaceNestDialogProps {
  open: boolean;
  /** World-space coordinates (already adjusted for pan/zoom). */
  mapX: number;
  mapY: number;
  /** Which Builder button opened the dialog. Defaults to "guided". */
  initialMode?: NestCreationMode;
  onClose: () => void;
  /**
   * Fired with the newly-created nest. The caller is responsible for
   * inserting it into the local store at the right time (e.g. after the
   * builder's build animation completes), so the sprite doesn't pop in
   * before the builder gets there.
   */
  onCreated?: (nest: Nest) => void;
}

export function PlaceNestDialog({
  open,
  mapX,
  mapY,
  initialMode = "guided",
  onClose,
  onCreated,
}: PlaceNestDialogProps) {
  const [state, dispatch] = useReducer(placeNestDialogReducer, null, () =>
    initialPlaceNestDialogState(initialMode),
  );
  const {
    initialGoal,
    answer,
    transcript,
    draft,
    name,
    goalPrompt,
    definitionOfDone,
    simpleMode,
    drafting,
    submitting,
    error,
    lastDraftAttempt,
  } = state;

  useEffect(() => {
    if (open) dispatch({ type: "reset", mode: initialMode });
  }, [open, initialMode]);

  const roundedMapX = Math.round(mapX);
  const roundedMapY = Math.round(mapY);

  const canSubmit = simpleMode
    ? goalPrompt.trim().length > 0
    : name.trim().length > 0 &&
      goalPrompt.trim().length > 0 &&
      definitionOfDone.trim().length > 0;

  const requestDraft = async (
    nextTranscript: GoalDraftTranscriptMessage[],
    currentDraft?: GoalSpecDraft,
  ) => {
    dispatch({
      type: "draftRequested",
      transcript: nextTranscript,
      currentDraft,
    });
    try {
      const response = await trpcClient.hedgemony.goalDraft.respond.mutate({
        transcript: nextTranscript,
        currentDraft,
        mapContext: { mapX: roundedMapX, mapY: roundedMapY },
      });

      if (response.kind === "ask_question") {
        dispatch({
          type: "draftQuestionReceived",
          transcript: nextTranscript,
          question: response.question,
        });
        return;
      }

      dispatch({
        type: "draftProposed",
        transcript: nextTranscript,
        draft: response.draft,
      });
    } catch (e) {
      log.error("Failed to draft goal spec", { error: e });
      dispatch({
        type: "draftFailed",
        message: e instanceof Error ? e.message : "Failed to draft goal spec",
      });
    }
  };

  const handleRetryDraft = () => {
    if (!lastDraftAttempt || drafting) return;
    void requestDraft(
      lastDraftAttempt.transcript,
      lastDraftAttempt.currentDraft,
    );
  };

  const handleStartDraft = () => {
    const content = initialGoal.trim();
    if (!content || drafting) return;
    void requestDraft([{ role: "user", content }]);
  };

  const handleAnswer = () => {
    const content = answer.trim();
    if (!content || drafting) return;
    const currentDraft = draft
      ? {
          ...draft,
          name,
          goalPrompt,
          definitionOfDone,
        }
      : undefined;
    void requestDraft([...transcript, { role: "user", content }], currentDraft);
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    dispatch({ type: "submitRequested" });
    try {
      const trimmedGoalPrompt = goalPrompt.trim();
      const effectiveName = simpleMode
        ? suggestName(trimmedGoalPrompt)
        : name.trim();

      const creationBootstrap =
        !simpleMode && draft?.bootstrapContext
          ? draft.bootstrapContext
          : undefined;

      const creationTranscript = simpleMode
        ? buildSimpleTranscript({ goalPrompt: trimmedGoalPrompt })
        : transcript;

      const created = await trpcClient.hedgemony.nests.create.mutate({
        name: effectiveName,
        goalPrompt: trimmedGoalPrompt,
        definitionOfDone: simpleMode ? null : definitionOfDone.trim(),
        mapX: roundedMapX,
        mapY: roundedMapY,
        creationMode: simpleMode ? "simple" : "guided",
        creationTranscript,
        creationBootstrap,
      });
      onCreated?.(created);
      onClose();
    } catch (e) {
      log.error("Failed to create nest", { error: e });
      dispatch({
        type: "submitFailed",
        message: e instanceof Error ? e.message : "Failed to create nest",
      });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content maxWidth="640px" size="2" className="max-h-[85vh]">
        <Dialog.Title size="3">Create a nest</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          Turn a rough goal into a spec-driven nest before creating it.
        </Dialog.Description>

        <ScrollArea type="auto" scrollbars="vertical" className="max-h-[64vh]">
          <Flex direction="column" gap="3" mt="4" pr="3">
            {simpleMode ? (
              <SimpleFormFields
                goalPrompt={goalPrompt}
                disabled={submitting}
                onGoalPromptChange={(value) =>
                  dispatch({
                    type: "fieldChanged",
                    field: "goalPrompt",
                    value,
                  })
                }
              />
            ) : (
              <GoalDraftFlow
                initialGoal={initialGoal}
                answer={answer}
                transcript={transcript}
                draft={draft}
                name={name}
                goalPrompt={goalPrompt}
                definitionOfDone={definitionOfDone}
                drafting={drafting}
                submitting={submitting}
                onInitialGoalChange={(value) =>
                  dispatch({
                    type: "fieldChanged",
                    field: "initialGoal",
                    value,
                  })
                }
                onAnswerChange={(value) =>
                  dispatch({ type: "fieldChanged", field: "answer", value })
                }
                onStartDraft={handleStartDraft}
                onAnswer={handleAnswer}
                onNameChange={(value) =>
                  dispatch({ type: "fieldChanged", field: "name", value })
                }
                onGoalPromptChange={(value) =>
                  dispatch({
                    type: "fieldChanged",
                    field: "goalPrompt",
                    value,
                  })
                }
                onDefinitionOfDoneChange={(value) =>
                  dispatch({
                    type: "fieldChanged",
                    field: "definitionOfDone",
                    value,
                  })
                }
              />
            )}

            <button
              type="button"
              onClick={() => dispatch({ type: "toggleSimpleMode" })}
              className="self-start text-(--accent-11) text-[13px] hover:text-(--accent-12)"
              disabled={submitting || drafting}
            >
              {simpleMode
                ? "Switch back to goal-writing flow"
                : "Eject to simple form"}
            </button>

            {error && (
              <Callout.Root color="red" size="1">
                <Callout.Text>{error}</Callout.Text>
                {lastDraftAttempt && (
                  <Flex mt="2" gap="2">
                    <Button
                      size="1"
                      variant="soft"
                      color="red"
                      onClick={handleRetryDraft}
                      disabled={drafting || submitting}
                      loading={drafting}
                    >
                      Try again
                    </Button>
                  </Flex>
                )}
              </Callout.Root>
            )}
          </Flex>
        </ScrollArea>

        {!simpleMode && drafting && (
          <div className="mt-3">
            <DraftingStatus />
          </div>
        )}

        <Flex gap="2" mt="4" justify="end">
          <Dialog.Close>
            <Button
              variant="soft"
              color="gray"
              disabled={submitting || drafting}
            >
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting || drafting}
            loading={submitting}
          >
            Create nest
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function GoalDraftFlow({
  initialGoal,
  answer,
  transcript,
  draft,
  name,
  goalPrompt,
  definitionOfDone,
  drafting,
  submitting,
  onInitialGoalChange,
  onAnswerChange,
  onStartDraft,
  onAnswer,
  onNameChange,
  onGoalPromptChange,
  onDefinitionOfDoneChange,
}: {
  initialGoal: string;
  answer: string;
  transcript: GoalDraftTranscriptMessage[];
  draft: GoalSpecDraft | null;
  name: string;
  goalPrompt: string;
  definitionOfDone: string;
  drafting: boolean;
  submitting: boolean;
  onInitialGoalChange: (value: string) => void;
  onAnswerChange: (value: string) => void;
  onStartDraft: () => void;
  onAnswer: () => void;
  onNameChange: (value: string) => void;
  onGoalPromptChange: (value: string) => void;
  onDefinitionOfDoneChange: (value: string) => void;
}) {
  const disabled = drafting || submitting;

  return (
    <>
      {draft && (
        <>
          {draft.bootstrapContext && (
            <BootstrapContextPanel context={draft.bootstrapContext} />
          )}
          <SpecFields
            name={name}
            goalPrompt={goalPrompt}
            definitionOfDone={definitionOfDone}
            disabled={submitting}
            onNameChange={onNameChange}
            onGoalPromptChange={onGoalPromptChange}
            onDefinitionOfDoneChange={onDefinitionOfDoneChange}
          />
        </>
      )}

      {transcript.length === 0 ? (
        <div>
          <Text
            as="label"
            htmlFor="nest-initial-goal"
            size="2"
            mb="1"
            weight="medium"
            className="block"
          >
            Rough goal
          </Text>
          <TextArea
            id="nest-initial-goal"
            placeholder="Improve checkout conversion"
            value={initialGoal}
            onChange={(e) => onInitialGoalChange(e.target.value)}
            rows={4}
            disabled={disabled}
            autoFocus
          />
          <Flex mt="2" justify="end">
            <Button
              size="2"
              variant="soft"
              onClick={onStartDraft}
              disabled={!initialGoal.trim() || disabled}
              loading={drafting}
            >
              Start spec draft
            </Button>
          </Flex>
        </div>
      ) : (
        <ConversationPanel
          transcript={transcript}
          answer={answer}
          disabled={disabled}
          drafting={drafting}
          onAnswerChange={onAnswerChange}
          onAnswer={onAnswer}
        />
      )}
    </>
  );
}

function DraftingStatus() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % DRAFTING_STATUS_WORDS.length);
    }, 1200);

    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      aria-live="polite"
      className="rounded-(--radius-2) border border-(--accent-5) bg-(--accent-2) px-3 py-2 text-(--accent-12)"
    >
      <Flex align="center" gap="2">
        <span
          aria-hidden="true"
          className="block h-2 w-2 shrink-0 animate-pulse rounded-full bg-(--accent-9)"
        />
        <Text size="2" weight="medium">
          {DRAFTING_STATUS_WORDS[index]}
        </Text>
      </Flex>
    </div>
  );
}

function ConversationPanel({
  transcript,
  answer,
  disabled,
  drafting,
  onAnswerChange,
  onAnswer,
}: {
  transcript: GoalDraftTranscriptMessage[];
  answer: string;
  disabled: boolean;
  drafting: boolean;
  onAnswerChange: (value: string) => void;
  onAnswer: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every transcript or drafting change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript.length, drafting]);

  return (
    <div className="flex flex-col rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2)">
      <div className="max-h-[220px] overflow-y-auto p-2">
        <Flex direction="column" gap="2">
          {transcript.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={
                message.role === "user"
                  ? "self-end rounded-(--radius-2) bg-(--accent-4) px-3 py-2 text-(--accent-12)"
                  : "self-start rounded-(--radius-2) bg-(--gray-1) px-3 py-2 text-(--gray-12)"
              }
            >
              <Text size="1" color="gray" weight="medium" className="block">
                {message.role === "user"
                  ? "Operator"
                  : message.kind === "spec_proposal"
                    ? "Spec draft"
                    : "Goal draft"}
              </Text>
              <Text as="p" size="2" className="whitespace-pre-wrap">
                {message.content}
              </Text>
            </div>
          ))}
          <div ref={bottomRef} />
        </Flex>
      </div>

      <div className="border-(--gray-5) border-t p-2">
        <Flex gap="2" align="end">
          <TextArea
            id="nest-draft-answer"
            className="flex-1"
            placeholder="Reply..."
            value={answer}
            onChange={(e) => onAnswerChange(e.target.value)}
            rows={1}
            disabled={disabled}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (answer.trim() && !disabled) onAnswer();
              }
            }}
          />
          <Button
            size="2"
            variant="soft"
            onClick={onAnswer}
            disabled={!answer.trim() || disabled}
            loading={drafting}
          >
            Send
          </Button>
        </Flex>
      </div>
    </div>
  );
}

function SimpleFormFields({
  goalPrompt,
  disabled,
  onGoalPromptChange,
}: {
  goalPrompt: string;
  disabled: boolean;
  onGoalPromptChange: (value: string) => void;
}) {
  return (
    <LabeledField label="Prompt" htmlFor="nest-goal">
      <TextArea
        id="nest-goal"
        placeholder="What should the hoglet work on?"
        value={goalPrompt}
        onChange={(e) => onGoalPromptChange(e.target.value)}
        rows={10}
        disabled={disabled}
        autoFocus
      />
    </LabeledField>
  );
}

function SpecFields({
  name,
  goalPrompt,
  definitionOfDone,
  disabled,
  onNameChange,
  onGoalPromptChange,
  onDefinitionOfDoneChange,
}: {
  name: string;
  goalPrompt: string;
  definitionOfDone: string;
  disabled: boolean;
  onNameChange: (value: string) => void;
  onGoalPromptChange: (value: string) => void;
  onDefinitionOfDoneChange: (value: string) => void;
}) {
  return (
    <Flex direction="column" gap="3">
      <LabeledField label="Name" htmlFor="nest-name">
        <TextField.Root
          id="nest-name"
          placeholder="Improve checkout conversion"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={disabled}
        />
      </LabeledField>

      <LabeledField label="Spec" htmlFor="nest-goal">
        <TextArea
          id="nest-goal"
          placeholder="Review or edit the generated feature spec."
          value={goalPrompt}
          onChange={(e) => onGoalPromptChange(e.target.value)}
          rows={10}
          disabled={disabled}
        />
      </LabeledField>

      <LabeledField
        label="Definition of done"
        htmlFor="nest-definition-of-done"
      >
        <TextArea
          id="nest-definition-of-done"
          placeholder="List what has to be true before this nest can close."
          value={definitionOfDone}
          onChange={(e) => onDefinitionOfDoneChange(e.target.value)}
          rows={4}
          disabled={disabled}
        />
      </LabeledField>
    </Flex>
  );
}

function BootstrapContextPanel({
  context,
}: {
  context: GoalSpecBootstrapContext;
}) {
  const repositories =
    context.repositories.length > 0
      ? context.repositories.join(", ")
      : "from the goal text";
  return (
    <div className="rounded-(--radius-2) border border-(--accent-5) bg-(--accent-2) px-3 py-2 text-(--accent-12)">
      <Text size="1" weight="medium" className="block">
        Local bootstrap
      </Text>
      <Text size="2" className="block">
        {repositories}
      </Text>
    </div>
  );
}

function LabeledField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex-1">
      <Text
        as="label"
        htmlFor={htmlFor}
        size="2"
        mb="1"
        weight="medium"
        className="block"
      >
        {label}
      </Text>
      {children}
    </div>
  );
}
