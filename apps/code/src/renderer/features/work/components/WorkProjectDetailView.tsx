import { Box, Flex, Text } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import { useCallback, useRef, useState } from "react";
import { ProjectCanvas } from "../canvas/ProjectCanvas";
import { useProjectCanvas } from "../canvas/useProjectCanvas";
import { useDeleteProjectWithUndo } from "../hooks/useDeleteProjectWithUndo";
import { usePinProject } from "../hooks/usePinProject";
import { ProjectChatPanel } from "./ProjectChatPanel";
import { ProjectHeader } from "./ProjectHeader";

const MIN_CONTENT_WIDTH = 360;
const MIN_PANEL_WIDTH = 360;
const DEFAULT_PANEL_WIDTH = 440;

export function WorkProjectDetailView() {
  const projectId = useNavigationStore((s) => s.workSelectedProjectId);
  const navigateToWorkProjects = useNavigationStore(
    (s) => s.navigateToWorkProjects,
  );

  const {
    project,
    isLoading,
    addTile,
    removeTile,
    resizeTileGrid,
    moveTile,
    applyPending,
    rejectPending,
    updateTitleTile,
    updateNoteTile,
    updateFileTile,
    updateChecklistItems,
  } = useProjectCanvas(projectId);

  const containerRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState<number>(DEFAULT_PANEL_WIDTH);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const startX = e.clientX;
      const startWidth = panelWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = startX - moveEvent.clientX;
        const maxWidth = Math.max(
          MIN_PANEL_WIDTH,
          containerRect.width - MIN_CONTENT_WIDTH,
        );
        const newWidth = Math.min(
          maxWidth,
          Math.max(MIN_PANEL_WIDTH, startWidth + delta),
        );
        setPanelWidth(newWidth);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [panelWidth],
  );

  const deleteWithUndo = useDeleteProjectWithUndo();
  const handleDelete = useCallback(async () => {
    if (!project) return;
    navigateToWorkProjects();
    await deleteWithUndo(project);
  }, [project, deleteWithUndo, navigateToWorkProjects]);

  const pinProject = usePinProject();
  const handleTogglePin = useCallback(
    async (pinned: boolean) => {
      if (!projectId) return;
      await pinProject(projectId, pinned);
    },
    [projectId, pinProject],
  );

  if (!projectId || (!project && !isLoading)) {
    return (
      <Box className="flex h-full w-full items-center justify-center">
        <Text as="div" className="text-(--gray-11) text-[13px]">
          Project not found.{" "}
          <button
            type="button"
            onClick={navigateToWorkProjects}
            className="text-(--gray-12) underline underline-offset-2"
          >
            Back to projects
          </button>
        </Text>
      </Box>
    );
  }

  if (!project) {
    return (
      <Box className="flex h-full w-full items-center justify-center">
        <Text as="div" className="text-(--gray-11) text-[13px]">
          Loading project…
        </Text>
      </Box>
    );
  }

  return (
    <Box height="100%" ref={containerRef}>
      <Flex height="100%">
        <Box className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <ProjectHeader
            project={project}
            onBack={navigateToWorkProjects}
            onUpdateTitle={updateTitleTile}
            onDelete={handleDelete}
            onTogglePin={handleTogglePin}
          />
          <Box className="min-h-0 flex-1">
            <ProjectCanvas
              projectId={project.id}
              tiles={project.tiles}
              members={project.members}
              onAddTile={async (tile) => {
                await addTile(tile, { state: "live", origin: "user" });
              }}
              onRemoveTile={async (tileId) => {
                await removeTile(tileId);
              }}
              onResizeTileGrid={async (tileId, size) => {
                await resizeTileGrid(tileId, size);
              }}
              onMoveTile={async (tileId, toIndex) => {
                await moveTile(tileId, toIndex);
              }}
              onApplyPending={async (tileId) => {
                await applyPending(tileId);
              }}
              onRejectPending={async (tileId) => {
                await rejectPending(tileId);
              }}
              onUpdateTitleTile={async (patch) => {
                await updateTitleTile(patch);
              }}
              onUpdateNoteTile={async (tileId, patch) => {
                await updateNoteTile(tileId, patch);
              }}
              onUpdateFileTile={async (tileId, patch) => {
                await updateFileTile(tileId, patch);
              }}
              onUpdateChecklistItems={async (tileId, items) => {
                await updateChecklistItems(tileId, items);
              }}
            />
          </Box>
        </Box>

        <Box
          onMouseDown={handleResizeStart}
          className="z-[1] w-[4px] shrink-0 cursor-col-resize border-l border-l-(--gray-6) bg-transparent transition-colors hover:bg-accent-6 active:bg-accent-8"
        />

        <Box
          style={{ width: `${panelWidth}px` }}
          className="h-full shrink-0 bg-(--gray-1)"
        >
          <ProjectChatPanel project={project} />
        </Box>
      </Flex>
    </Box>
  );
}
