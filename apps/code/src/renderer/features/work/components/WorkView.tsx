import { useNavigationStore } from "@stores/navigationStore";
import { MemoryView } from "../../memory/components/MemoryView";
import { ScheduledTaskEditor } from "./ScheduledTaskEditor";
import { ScheduledTasksList } from "./ScheduledTasksList";
import { WorkDataSourcesView } from "./WorkDataSourcesView";
import { WorkGenerateView } from "./WorkGenerateView";
import { WorkHome } from "./WorkHome";
import { WorkProjectDetailView } from "./WorkProjectDetailView";
import { WorkProjectsView } from "./WorkProjectsView";
import { WorkScheduledCreatePrompt } from "./WorkScheduledCreatePrompt";
import { WorkSkillDetailView } from "./WorkSkillDetailView";
import { WorkSkillsView } from "./WorkSkillsView";
import { WorkTaskDetailView } from "./WorkTaskDetailView";

export function WorkView() {
  const workView = useNavigationStore((s) => s.workView);
  const scheduledEditId = useNavigationStore((s) => s.workScheduledEditId);

  if (workView === "generate") {
    return <WorkGenerateView />;
  }

  if (workView === "skill-detail") {
    return <WorkSkillDetailView />;
  }

  if (workView === "library") {
    return <WorkSkillsView />;
  }

  if (workView === "scheduled-list") {
    return <ScheduledTasksList />;
  }

  if (workView === "scheduled-create-prompt") {
    return <WorkScheduledCreatePrompt />;
  }

  if (workView === "scheduled-edit") {
    return <ScheduledTaskEditor editingId={scheduledEditId ?? null} />;
  }

  if (workView === "data-sources") {
    return <WorkDataSourcesView />;
  }

  if (workView === "memory") {
    return <MemoryView />;
  }

  if (workView === "projects") {
    return <WorkProjectsView />;
  }

  if (workView === "project-detail") {
    return <WorkProjectDetailView />;
  }

  if (workView === "task-detail") {
    return <WorkTaskDetailView />;
  }

  return <WorkHome />;
}
