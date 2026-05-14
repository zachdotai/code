import type {
  GoalDraftTranscriptMessage,
  GoalSpecDraft,
} from "@main/services/hedgemony/schemas";
import {
  Button,
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
import { useEffect, useMemo, useState } from "react";
import { useNestStore } from "../stores/nestStore";

const log = logger.scope("place-nest-dialog");

export type NestCreationMode = "guided" | "simple";

export interface PlaceNestDialogProps {
  open: boolean;
  /** World-space coordinates (already adjusted for pan/zoom). */
  mapX: number;
  mapY: number;
  /** Which Builder button opened the dialog. Defaults to "guided". */
  initialMode?: NestCreationMode;
  onClose: () => void;
  onCreated?: (mapX: number, mapY: number) => void;
}

export function PlaceNestDialog({
  open,
  mapX,
  mapY,
  initialMode = "guided",
  onClose,
  onCreated,
}: PlaceNestDialogProps) {
  const [initialGoal, setInitialGoal] = useState("");
  const [answer, setAnswer] = useState("");
  const [transcript, setTranscript] = useState<GoalDraftTranscriptMessage[]>(
    [],
  );
  const [draft, setDraft] = useState<GoalSpecDraft | null>(null);
  const [name, setName] = useState("");
  const [goalPrompt, setGoalPrompt] = useState("");
  const [definitionOfDone, setDefinitionOfDone] = useState("");
  const [mapXValue, setMapXValue] = useState("");
  const [mapYValue, setMapYValue] = useState("");
  const [simpleMode, setSimpleMode] = useState(initialMode === "simple");
  const [drafting, setDrafting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setInitialGoal("");
      setAnswer("");
      setTranscript([]);
      setDraft(null);
      setName("");
      setGoalPrompt("");
      setDefinitionOfDone("");
      setMapXValue(String(Math.round(mapX)));
      setMapYValue(String(Math.round(mapY)));
      setSimpleMode(initialMode === "simple");
      setError(null);
      setDrafting(false);
      setSubmitting(false);
    }
  }, [open, initialMode, mapX, mapY]);

  const parsedMapX = useMemo(() => Number(mapXValue), [mapXValue]);
  const parsedMapY = useMemo(() => Number(mapYValue), [mapYValue]);
  const hasValidCoords =
    Number.isFinite(parsedMapX) && Number.isFinite(parsedMapY);

  const canSubmit =
    name.trim().length > 0 &&
    goalPrompt.trim().length > 0 &&
    hasValidCoords &&
    (simpleMode || definitionOfDone.trim().length > 0);

  const requestDraft = async (
    nextTranscript: GoalDraftTranscriptMessage[],
    currentDraft?: GoalSpecDraft,
  ) => {
    setDrafting(true);
    setError(null);
    try {
      const response = await trpcClient.hedgemony.goalDraft.respond.mutate({
        transcript: nextTranscript,
        currentDraft,
        mapContext: hasValidCoords
          ? {
              mapX: Math.round(parsedMapX),
              mapY: Math.round(parsedMapY),
            }
          : undefined,
      });

      if (response.kind === "ask_question") {
        setTranscript([
          ...nextTranscript,
          { role: "assistant", content: response.question },
        ]);
        setAnswer("");
        return;
      }

      const nextDraft = response.draft;
      setDraft(nextDraft);
      setName(nextDraft.name);
      setGoalPrompt(nextDraft.goalPrompt);
      setDefinitionOfDone(nextDraft.definitionOfDone);
      setTranscript([
        ...nextTranscript,
        { role: "assistant", content: formatDraftForTranscript(nextDraft) },
      ]);
      setAnswer("");
    } catch (e) {
      log.error("Failed to draft goal spec", { error: e });
      setError(e instanceof Error ? e.message : "Failed to draft goal spec");
    } finally {
      setDrafting(false);
    }
  };

  const handleStartDraft = () => {
    const content = initialGoal.trim();
    if (!content || drafting) return;
    const nextTranscript: GoalDraftTranscriptMessage[] = [
      { role: "user", content },
    ];
    setTranscript(nextTranscript);
    void requestDraft(nextTranscript);
  };

  const handleAnswer = () => {
    const content = answer.trim();
    if (!content || drafting) return;
    const nextTranscript: GoalDraftTranscriptMessage[] = [
      ...transcript,
      { role: "user", content },
    ];
    setTranscript(nextTranscript);
    void requestDraft(nextTranscript, draft ?? undefined);
  };

  const handleToggleSimpleMode = () => {
    if (!simpleMode) {
      const fallbackGoal = goalPrompt.trim() || initialGoal.trim();
      if (!goalPrompt.trim() && fallbackGoal) setGoalPrompt(fallbackGoal);
      if (!name.trim() && fallbackGoal) setName(suggestName(fallbackGoal));
    }
    setSimpleMode((value) => !value);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const creationTranscript = simpleMode
        ? buildSimpleTranscript({
            name: name.trim(),
            goalPrompt: goalPrompt.trim(),
            definitionOfDone: definitionOfDone.trim(),
          })
        : transcript;

      const created = await trpcClient.hedgemony.nests.create.mutate({
        name: name.trim(),
        goalPrompt: goalPrompt.trim(),
        definitionOfDone: simpleMode
          ? definitionOfDone.trim() || null
          : definitionOfDone.trim(),
        mapX: Math.round(parsedMapX),
        mapY: Math.round(parsedMapY),
        creationMode: simpleMode ? "simple" : "guided",
        creationTranscript,
      });
      // Insert locally so the sprite renders immediately and the store's
      // diff effect opens a watch subscription for it.
      useNestStore.getState().upsert(created);
      onCreated?.(created.mapX, created.mapY);
      onClose();
    } catch (e) {
      log.error("Failed to create nest", { error: e });
      setError(e instanceof Error ? e.message : "Failed to create nest");
      setSubmitting(false);
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
                name={name}
                goalPrompt={goalPrompt}
                definitionOfDone={definitionOfDone}
                disabled={submitting}
                onNameChange={setName}
                onGoalPromptChange={setGoalPrompt}
                onDefinitionOfDoneChange={setDefinitionOfDone}
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
                onInitialGoalChange={setInitialGoal}
                onAnswerChange={setAnswer}
                onStartDraft={handleStartDraft}
                onAnswer={handleAnswer}
                onNameChange={setName}
                onGoalPromptChange={setGoalPrompt}
                onDefinitionOfDoneChange={setDefinitionOfDone}
              />
            )}

            <Flex gap="2">
              <LabeledField label="X" htmlFor="nest-map-x">
                <TextField.Root
                  id="nest-map-x"
                  type="number"
                  value={mapXValue}
                  onChange={(e) => setMapXValue(e.target.value)}
                  disabled={submitting}
                />
              </LabeledField>
              <LabeledField label="Y" htmlFor="nest-map-y">
                <TextField.Root
                  id="nest-map-y"
                  type="number"
                  value={mapYValue}
                  onChange={(e) => setMapYValue(e.target.value)}
                  disabled={submitting}
                />
              </LabeledField>
            </Flex>

            <button
              type="button"
              onClick={handleToggleSimpleMode}
              className="self-start text-(--accent-11) text-[13px] hover:text-(--accent-12)"
              disabled={submitting || drafting}
            >
              {simpleMode
                ? "Switch back to goal-writing flow"
                : "Eject to simple form"}
            </button>

            {error && (
              <Text size="2" color="red">
                {error}
              </Text>
            )}
          </Flex>
        </ScrollArea>

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
        <Transcript transcript={transcript} />
      )}

      {transcript.length > 0 && !draft && (
        <div>
          <Text
            as="label"
            htmlFor="nest-draft-answer"
            size="2"
            mb="1"
            weight="medium"
            className="block"
          >
            Answer
          </Text>
          <TextArea
            id="nest-draft-answer"
            placeholder="Add the missing context"
            value={answer}
            onChange={(e) => onAnswerChange(e.target.value)}
            rows={3}
            disabled={disabled}
            autoFocus
          />
          <Flex mt="2" justify="end">
            <Button
              size="2"
              variant="soft"
              onClick={onAnswer}
              disabled={!answer.trim() || disabled}
              loading={drafting}
            >
              Continue
            </Button>
          </Flex>
        </div>
      )}

      {draft && (
        <SpecFields
          name={name}
          goalPrompt={goalPrompt}
          definitionOfDone={definitionOfDone}
          disabled={submitting}
          onNameChange={onNameChange}
          onGoalPromptChange={onGoalPromptChange}
          onDefinitionOfDoneChange={onDefinitionOfDoneChange}
        />
      )}
    </>
  );
}

function SimpleFormFields({
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
    <SpecFields
      name={name}
      goalPrompt={goalPrompt}
      definitionOfDone={definitionOfDone}
      disabled={disabled}
      onNameChange={onNameChange}
      onGoalPromptChange={onGoalPromptChange}
      onDefinitionOfDoneChange={onDefinitionOfDoneChange}
    />
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

function Transcript({
  transcript,
}: {
  transcript: GoalDraftTranscriptMessage[];
}) {
  return (
    <div className="max-h-[190px] overflow-y-auto rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) p-2">
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
              {message.role === "user" ? "Operator" : "Goal draft"}
            </Text>
            <Text as="p" size="2" className="whitespace-pre-wrap">
              {message.content}
            </Text>
          </div>
        ))}
      </Flex>
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

function formatDraftForTranscript(draft: GoalSpecDraft): string {
  return [
    "Proposed spec",
    "",
    `Name: ${draft.name}`,
    `Summary: ${draft.summary}`,
    `Spec:\n${draft.goalPrompt}`,
    `Definition of done: ${draft.definitionOfDone}`,
  ].join("\n");
}

function suggestName(goal: string): string {
  const firstLine = goal.split("\n")[0].trim();
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function buildSimpleTranscript(input: {
  name: string;
  goalPrompt: string;
  definitionOfDone: string;
}): GoalDraftTranscriptMessage[] {
  return [
    {
      role: "user",
      content: [
        "Created through simple form.",
        "",
        `Name: ${input.name}`,
        `Spec: ${input.goalPrompt}`,
        input.definitionOfDone
          ? `Definition of done: ${input.definitionOfDone}`
          : "Definition of done: not set yet",
      ].join("\n"),
    },
  ];
}
