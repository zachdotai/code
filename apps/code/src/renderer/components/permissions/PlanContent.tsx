import { DEFAULT_TAB_IDS } from "@features/panels/constants/panelConstants";
import { usePanelLayoutStore } from "@features/panels/store/panelLayoutStore";
import { findTabInTree } from "@features/panels/store/panelTree";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { useTaskStore } from "@features/tasks/stores/taskStore";
import {
  ArrowsIn,
  ArrowsOut,
  ListChecks,
  SidebarSimple,
  X,
} from "@phosphor-icons/react";
import { Box, Flex, IconButton, Text, Tooltip } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const planScrollPosition = new Map<string, number>();

interface PlanContentProps {
  id: string;
  plan: string;
}

function openPlanTab(taskId: string): void {
  const { taskLayouts, setActiveTab } = usePanelLayoutStore.getState();
  const layout = taskLayouts[taskId];
  if (!layout) return;
  const result = findTabInTree(layout.panelTree, DEFAULT_TAB_IDS.PLAN);
  if (result) {
    setActiveTab(taskId, result.panelId, DEFAULT_TAB_IDS.PLAN);
  }
}

export function PlanContent({ id, plan }: PlanContentProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const taskId = useTaskStore((s) => s.selectedTaskId);
  const planThreadsEnabled = useSettingsStore((s) => s.planThreadsEnabled);
  const hasPlanTab = usePanelLayoutStore((state) => {
    if (!taskId) return false;
    const layout = state.taskLayouts[taskId];
    if (!layout) return false;
    return !!findTabInTree(layout.panelTree, DEFAULT_TAB_IDS.PLAN);
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const position = planScrollPosition.get(id);
    if (position !== undefined) {
      el.scrollTop = position;
    }

    const handleScroll = () => {
      planScrollPosition.set(id, el.scrollTop);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      el.removeEventListener("scroll", handleScroll);
    };
  }, [id]);

  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isFullscreen]);

  const markdown = (
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
  );

  if (isFullscreen) {
    const portalTarget = document.getElementById("fullscreen-portal");
    if (portalTarget) {
      return (
        <>
          <Flex justify="end" className="py-0.5">
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              onClick={() => setIsFullscreen(false)}
              title="Exit fullscreen"
            >
              <ArrowsIn size={12} />
            </IconButton>
          </Flex>

          {createPortal(
            <Box className="pointer-events-auto absolute inset-0 flex flex-col bg-blue-2">
              <Flex
                align="center"
                justify="between"
                className="border-blue-6 border-b px-4 py-2"
              >
                <Flex align="center" gap="2">
                  <ListChecks size={14} className="text-blue-11" />
                  <Text className="text-blue-11 text-sm">Plan</Text>
                </Flex>
                <IconButton
                  size="1"
                  variant="ghost"
                  color="gray"
                  onClick={() => setIsFullscreen(false)}
                  title="Exit fullscreen (Escape)"
                >
                  <X size={14} />
                </IconButton>
              </Flex>

              <Box
                ref={scrollRef}
                className="plan-markdown flex-1 overflow-y-auto p-6 text-blue-12"
              >
                {markdown}
              </Box>
            </Box>,
            portalTarget,
          )}
        </>
      );
    }
  }

  return (
    <Box
      ref={scrollRef}
      className="relative max-h-[50vh] max-w-[750px] overflow-y-auto rounded-lg border-2 border-blue-6 bg-blue-2 p-4"
    >
      <Flex gap="1" align="center" className="sticky top-0 z-10 float-right">
        {planThreadsEnabled && taskId && hasPlanTab && (
          <Tooltip content="Open in Plan view">
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              onClick={() => openPlanTab(taskId)}
              title="Open in Plan view"
            >
              <SidebarSimple size={12} />
            </IconButton>
          </Tooltip>
        )}
        <IconButton
          size="1"
          variant="ghost"
          color="gray"
          onClick={() => setIsFullscreen(true)}
          title="Expand to fullscreen"
        >
          <ArrowsOut size={12} />
        </IconButton>
      </Flex>

      <Box className="plan-markdown text-blue-12">{markdown}</Box>
    </Box>
  );
}
