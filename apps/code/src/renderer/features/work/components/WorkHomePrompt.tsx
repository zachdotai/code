import { PromptInput } from "@features/message-editor/components/PromptInput";
import { useNavigationStore } from "@stores/navigationStore";
import { useCallback } from "react";

const WORK_HOME_SESSION_ID = "work-home";

export function WorkHomePrompt() {
  const setMode = useNavigationStore((s) => s.setMode);
  const navigateToTaskInput = useNavigationStore((s) => s.navigateToTaskInput);

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setMode("code");
      navigateToTaskInput({ initialPrompt: trimmed });
    },
    [setMode, navigateToTaskInput],
  );

  return (
    <PromptInput
      sessionId={WORK_HOME_SESSION_ID}
      placeholder="What should I take off your plate this week?"
      autoFocus
      clearOnSubmit
      editorHeight="large"
      enableCommands={false}
      enableBashMode={false}
      onSubmit={handleSubmit}
    />
  );
}
