import { useNavigationStore } from "@stores/navigationStore";
import { McpServersView } from "../../mcp-servers/components/McpServersView";
import { ScheduledTaskEditor } from "./ScheduledTaskEditor";
import { ScheduledTasksList } from "./ScheduledTasksList";
import { WorkGenerateView } from "./WorkGenerateView";
import { WorkHome } from "./WorkHome";
import { WorkSkillDetailView } from "./WorkSkillDetailView";
import { WorkSkillsView } from "./WorkSkillsView";

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

  if (workView === "scheduled-edit") {
    return <ScheduledTaskEditor editingId={scheduledEditId ?? null} />;
  }

  if (workView === "data-sources") {
    return <McpServersView />;
  }

  return <WorkHome />;
}
