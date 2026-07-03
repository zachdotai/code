import {
  type QuestionItem,
  type QuestionMeta,
  QuestionMetaSchema,
} from "@posthog/agent/adapters/claude/questions/utils";
import {
  ActionSelector,
  CANCEL_OPTION_ID,
  filterOtherOptions,
  parseOptionIndex,
  type SelectorOption,
  type StepAnswer,
  type StepInfo,
  SUBMIT_OPTION_ID,
} from "@posthog/ui/primitives/ActionSelector";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuestionDraftStore } from "./questionDraftStore";
import { type BasePermissionProps, toSelectorOptions } from "./types";

function parseQuestionMeta(raw: unknown): QuestionMeta | undefined {
  const result = QuestionMetaSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}

function questionOptionsToSelectorOptions(
  question: QuestionItem,
): SelectorOption[] {
  return question.options.map((opt, idx) => ({
    id: `option_${idx}`,
    label: opt.label,
    description: opt.description,
  }));
}

interface FormattedAnswer {
  question: string;
  answer: string;
}

function formatStepAnswers(
  stepAnswers: Map<number, StepAnswer>,
  allQuestions: QuestionItem[],
): FormattedAnswer[] {
  return Array.from(stepAnswers.entries())
    .sort(([a], [b]) => a - b)
    .map(([stepIdx, answer]) => {
      const question = allQuestions[stepIdx];
      const filteredIds = filterOtherOptions(answer.selectedIds);
      const optionLabels = filteredIds.map((optionId) => {
        const optionIndex = parseOptionIndex(optionId);
        return question?.options[optionIndex]?.label ?? optionId;
      });
      const parts: string[] = [];
      if (optionLabels.length > 0) {
        parts.push(optionLabels.join(", "));
      }
      if (answer.customInput?.trim()) {
        parts.push(answer.customInput.trim());
      }
      return {
        question: question?.question ?? `Question ${stepIdx + 1}`,
        answer: parts.join(", "),
      };
    })
    .filter((a) => a.answer.trim() !== "");
}

function buildAnswersRecord(
  stepAnswers: Map<number, StepAnswer>,
  allQuestions: QuestionItem[],
): Record<string, string> {
  const formatted = formatStepAnswers(stepAnswers, allQuestions);
  const result: Record<string, string> = {};
  for (const { question, answer } of formatted) {
    result[question] = answer;
  }
  return result;
}

function isQuestionAnswered(
  stepAnswers: Map<number, StepAnswer>,
  questionIndex: number,
): boolean {
  const answer = stepAnswers.get(questionIndex);
  if (!answer) return false;
  const hasOptions = filterOtherOptions(answer.selectedIds).length > 0;
  const hasCustomInput = !!answer.customInput?.trim();
  return hasOptions || hasCustomInput;
}

export function QuestionPermission({
  toolCall,
  options,
  onSelect,
  onCancel,
}: BasePermissionProps) {
  const meta = parseQuestionMeta(toolCall._meta);
  const allQuestions = meta?.questions ?? [];
  const totalQuestions = allQuestions.length;

  // Drafts are keyed per question (the tool-call id), so a half-typed answer
  // survives switching to another session and back.
  const questionId = toolCall.toolCallId;
  const { getDraft, setDraft, clearDraft } = useQuestionDraftStore(
    (s) => s.actions,
  );

  const [activeStep, setActiveStep] = useState(
    () => getDraft(questionId)?.activeStep ?? 0,
  );
  const [stepAnswers, setStepAnswers] = useState<Map<number, StepAnswer>>(
    () => {
      const saved = getDraft(questionId)?.stepAnswers;
      return saved
        ? new Map(
            Object.entries(saved).map(([step, answer]) => [
              Number(step),
              answer,
            ]),
          )
        : new Map();
    },
  );

  // Persist the draft on every change, but only while it holds real content, so
  // questions the user never answers (or that the agent later removes without a
  // submit/cancel) don't leave empty entries accumulating in storage.
  useEffect(() => {
    const hasContent = Array.from(stepAnswers.values()).some(
      (answer) =>
        answer.selectedIds.length > 0 || answer.customInput.trim() !== "",
    );
    if (hasContent) {
      setDraft(questionId, {
        activeStep,
        stepAnswers: Object.fromEntries(stepAnswers),
      });
    } else {
      clearDraft(questionId);
    }
  }, [questionId, activeStep, stepAnswers, setDraft, clearDraft]);

  // Snapshot of persisted answers used to seed the selector's per-step state on
  // mount, so restored values are shown when navigating between steps.
  const [initialStepAnswers] = useState(() => Object.fromEntries(stepAnswers));

  const isOnSubmitStep = activeStep >= totalQuestions;

  const activeQuestion = isOnSubmitStep ? undefined : allQuestions[activeStep];
  const isMultiSelect = activeQuestion?.multiSelect ?? false;
  const questionText = activeQuestion?.question ?? toolCall.title ?? "Question";
  const headerText = activeQuestion?.header ?? "Question";

  const activeOptions = activeQuestion
    ? questionOptionsToSelectorOptions(activeQuestion)
    : toSelectorOptions(options);

  const currentStepAnswer = stepAnswers.get(activeStep);

  const advanceStep = useCallback(
    (optionIds: string[], customInput?: string) => {
      setStepAnswers((prev) => {
        const next = new Map(prev);
        next.set(activeStep, {
          selectedIds: optionIds,
          customInput: customInput ?? "",
        });
        return next;
      });

      if (activeStep < totalQuestions - 1) {
        setActiveStep(activeStep + 1);
      } else {
        setActiveStep(totalQuestions);
      }
    },
    [activeStep, totalQuestions],
  );

  const resolveSelect = useCallback(
    (
      optionId: string,
      customInput?: string,
      answers?: Record<string, string>,
    ) => {
      clearDraft(questionId);
      onSelect(optionId, customInput, answers);
    },
    [clearDraft, questionId, onSelect],
  );

  const handleCancel = useCallback(() => {
    clearDraft(questionId);
    onCancel();
  }, [clearDraft, questionId, onCancel]);

  const handleMultiSelect = useCallback(
    (optionIds: string[], customInput?: string) => {
      if (totalQuestions === 1) {
        const filteredIds = filterOtherOptions(optionIds);
        const singleAnswer: Map<number, StepAnswer> = new Map([
          [0, { selectedIds: optionIds, customInput: customInput ?? "" }],
        ]);
        const answers = buildAnswersRecord(singleAnswer, allQuestions);
        resolveSelect(filteredIds[0] ?? "other", customInput, answers);
        return;
      }
      advanceStep(optionIds, customInput);
    },
    [totalQuestions, resolveSelect, advanceStep, allQuestions],
  );

  const handleSelect = useCallback(
    (optionId: string, customInput?: string) => {
      if (isOnSubmitStep) {
        if (optionId === CANCEL_OPTION_ID) {
          handleCancel();
          return;
        }
        const answers = buildAnswersRecord(stepAnswers, allQuestions);
        resolveSelect(SUBMIT_OPTION_ID, undefined, answers);
        return;
      }

      if (totalQuestions === 1) {
        const singleAnswer: Map<number, StepAnswer> = new Map([
          [0, { selectedIds: [optionId], customInput: customInput ?? "" }],
        ]);
        const answers = buildAnswersRecord(singleAnswer, allQuestions);
        resolveSelect(optionId, customInput, answers);
        return;
      }

      advanceStep([optionId], customInput);
    },
    [
      isOnSubmitStep,
      stepAnswers,
      allQuestions,
      totalQuestions,
      resolveSelect,
      handleCancel,
      advanceStep,
    ],
  );

  const handleStepAnswer = useCallback(
    (stepIndex: number, optionIds: string[], customInput?: string) => {
      setStepAnswers((prev) => {
        const next = new Map(prev);
        next.set(stepIndex, {
          selectedIds: optionIds,
          customInput: customInput ?? "",
        });
        return next;
      });
    },
    [],
  );

  // Persist in-progress edits to the current step before it is committed via a
  // step change or submit, so half-typed text is not lost on a session switch.
  const handleDraftChange = useCallback(
    (stepIndex: number, optionIds: string[], customInput: string) => {
      setStepAnswers((prev) => {
        const next = new Map(prev);
        next.set(stepIndex, { selectedIds: optionIds, customInput });
        return next;
      });
    },
    [],
  );

  const handleStepChange = useCallback((stepIndex: number) => {
    setActiveStep(stepIndex);
  }, []);

  const hasUnanswered = useMemo(() => {
    for (let i = 0; i < totalQuestions; i++) {
      if (!isQuestionAnswered(stepAnswers, i)) {
        return true;
      }
    }
    return false;
  }, [totalQuestions, stepAnswers]);

  const steps = useMemo((): StepInfo[] | undefined => {
    if (totalQuestions <= 1) return undefined;

    const questionSteps = allQuestions.map((q, i) => ({
      label: q.header ?? `Question ${i + 1}`,
      completed: q.completed ?? isQuestionAnswered(stepAnswers, i),
    }));

    return [...questionSteps, { label: "Submit", completed: false }];
  }, [totalQuestions, allQuestions, stepAnswers]);

  const renderAnswersSummary = () => {
    const localAnswers = formatStepAnswers(stepAnswers, allQuestions);
    if (localAnswers.length === 0) return null;

    return (
      <Box mb="3">
        {hasUnanswered && (
          <Flex align="center" gap="2" mb="2">
            <Text className="text-[13px] text-yellow-11">
              You have not answered all questions
            </Text>
          </Flex>
        )}
        {localAnswers.map((a) => (
          <Flex direction="column" key={a.question} mb="2">
            <Text className="text-[13px] text-gray-11">{a.question}</Text>
            <Text className="text-[13px] text-blue-11">{a.answer}</Text>
          </Flex>
        ))}
      </Box>
    );
  };

  const hasSteps = steps !== undefined && steps.length > 1;
  const showTitle = !hasSteps || isOnSubmitStep;

  return (
    <ActionSelector
      title={
        showTitle ? (isOnSubmitStep ? "Review your answers" : headerText) : ""
      }
      question={isOnSubmitStep ? "Ready to submit your answers?" : questionText}
      pendingAction={isOnSubmitStep ? renderAnswersSummary() : undefined}
      options={
        isOnSubmitStep
          ? [
              { id: SUBMIT_OPTION_ID, label: "Submit" },
              { id: CANCEL_OPTION_ID, label: "Cancel" },
            ]
          : activeOptions
      }
      multiSelect={isOnSubmitStep ? false : isMultiSelect}
      hideSubmitButton={isOnSubmitStep}
      allowCustomInput={!isOnSubmitStep}
      customInputPlaceholder="Type your answer..."
      currentStep={activeStep}
      steps={steps}
      initialSelections={currentStepAnswer?.selectedIds}
      initialCustomInput={currentStepAnswer?.customInput}
      initialStepAnswers={initialStepAnswers}
      onSelect={handleSelect}
      onMultiSelect={handleMultiSelect}
      onCancel={handleCancel}
      onStepChange={handleStepChange}
      onStepAnswer={handleStepAnswer}
      onDraftChange={handleDraftChange}
    />
  );
}
