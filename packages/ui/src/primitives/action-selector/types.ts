import type { ReactNode } from "react";

export interface SelectorOption {
  id: string;
  label: string;
  description?: string;
  customInput?: boolean;
}

export interface StepInfo {
  label: string;
  completed?: boolean;
}

export interface StepAnswer {
  selectedIds: string[];
  customInput: string;
}

export interface ActionSelectorProps {
  title: ReactNode;
  pendingAction?: ReactNode;
  question: ReactNode;
  options: SelectorOption[];
  multiSelect?: boolean;
  allowCustomInput?: boolean;
  customInputPlaceholder?: string;
  currentStep?: number;
  steps?: StepInfo[];
  initialSelections?: string[];
  // Restores an in-progress free-text answer (e.g. after remounting).
  initialCustomInput?: string;
  // Seeds per-step answers so navigating between steps after a remount shows
  // previously entered values. Only read on mount.
  initialStepAnswers?: Record<number, StepAnswer>;
  hideSubmitButton?: boolean;
  onSelect: (optionId: string, customInput?: string) => void;
  onMultiSelect?: (optionIds: string[], customInput?: string) => void;
  onCancel?: () => void;
  onStepChange?: (stepIndex: number) => void;
  onStepAnswer?: (
    stepIndex: number,
    optionIds: string[],
    customInput?: string,
  ) => void;
  // Fires on every edit to the current step's selection or free-text input, so
  // a caller can persist a draft that is not yet committed via onStepAnswer.
  onDraftChange?: (
    stepIndex: number,
    optionIds: string[],
    customInput: string,
  ) => void;
}
