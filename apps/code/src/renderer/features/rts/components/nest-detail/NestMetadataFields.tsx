import { TextArea, TextField } from "@radix-ui/themes";
import { LabeledField } from "./LabeledField";

interface NestMetadataFieldsProps {
  name: string;
  onNameChange: (value: string) => void;
  goalPrompt: string;
  onGoalPromptChange: (value: string) => void;
  definitionOfDone: string;
  onDefinitionOfDoneChange: (value: string) => void;
  disabled: boolean;
}

export function NestMetadataFields({
  name,
  onNameChange,
  goalPrompt,
  onGoalPromptChange,
  definitionOfDone,
  onDefinitionOfDoneChange,
  disabled,
}: NestMetadataFieldsProps) {
  return (
    <>
      <LabeledField label="Name" htmlFor="nest-detail-name">
        <TextField.Root
          id="nest-detail-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={disabled}
        />
      </LabeledField>

      <LabeledField label="Goal" htmlFor="nest-detail-goal">
        <TextArea
          id="nest-detail-goal"
          value={goalPrompt}
          onChange={(e) => onGoalPromptChange(e.target.value)}
          rows={3}
          disabled={disabled}
        />
      </LabeledField>

      <LabeledField label="Definition of done" htmlFor="nest-detail-definition">
        <TextArea
          id="nest-detail-definition"
          value={definitionOfDone}
          onChange={(e) => onDefinitionOfDoneChange(e.target.value)}
          rows={2}
          disabled={disabled}
        />
      </LabeledField>
    </>
  );
}
