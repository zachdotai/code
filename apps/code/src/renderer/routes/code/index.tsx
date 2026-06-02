import { TaskInput } from "@features/task-detail/components/TaskInput";
import { useNavigationStore } from "@stores/navigationStore";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code/")({
  component: CodeIndexRoute,
});

function CodeIndexRoute() {
  const view = useNavigationStore((s) => s.view);
  const taskInputReportAssociation = useNavigationStore(
    (s) => s.taskInputReportAssociation,
  );
  const taskInputCloudRepository = useNavigationStore(
    (s) => s.taskInputCloudRepository,
  );

  const initialPrompt =
    view.type === "task-input" ? view.initialPrompt : undefined;
  const initialPromptKey =
    view.type === "task-input" ? view.taskInputRequestId : undefined;
  const initialCloudRepository =
    view.type === "task-input"
      ? (view.initialCloudRepository ?? taskInputCloudRepository)
      : taskInputCloudRepository;
  const initialModel =
    view.type === "task-input" ? view.initialModel : undefined;
  const initialMode = view.type === "task-input" ? view.initialMode : undefined;
  const reportAssociation =
    view.type === "task-input"
      ? (view.reportAssociation ?? taskInputReportAssociation)
      : taskInputReportAssociation;

  return (
    <TaskInput
      initialPrompt={initialPrompt}
      initialPromptKey={initialPromptKey}
      initialCloudRepository={initialCloudRepository}
      initialModel={initialModel}
      initialMode={initialMode}
      reportAssociation={reportAssociation}
    />
  );
}
