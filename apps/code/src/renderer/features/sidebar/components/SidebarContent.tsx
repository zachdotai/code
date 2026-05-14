import { useArchivedTaskIds } from "@features/archive/hooks/useArchivedTaskIds";
import { SidebarUsageBar } from "@features/billing/components/SidebarUsageBar";
import { GeneratedCanvasButton } from "@features/rendering-canvas/GeneratedCanvasButton";
import { PrimitivesDemoApiButton } from "@features/rendering-canvas/PrimitivesDemoApiButton";
import { SdkUsageCanvasButton } from "@features/rendering-canvas/SdkUsageCanvasButton";
import { TestCanvasButton } from "@features/rendering-canvas/TestCanvasButton";
import { useSidebarStore } from "@features/sidebar/stores/sidebarStore";
import { ArchiveIcon } from "@phosphor-icons/react";
import { Box, Flex } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import type React from "react";
import { AddCanvasButton } from "./AddCanvasButton";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SidebarMenu } from "./SidebarMenu";
import { UpdateBanner } from "./UpdateBanner";

export const SidebarContent: React.FC = () => {
  const archivedTaskIds = useArchivedTaskIds();
  const activeTab = useSidebarStore((state) => state.activeTab);
  const navigateToArchived = useNavigationStore(
    (state) => state.navigateToArchived,
  );
  return (
    <Flex direction="column" height="100%">
      <Box flexGrow="1" overflow="hidden">
        <SidebarMenu />
      </Box>
      <UpdateBanner />
      <SidebarUsageBar />
      {activeTab === "files" && <AddCanvasButton />}
      <Box className="shrink-0 border-gray-6 border-t">
        <TestCanvasButton />
      </Box>
      <Box className="shrink-0 border-gray-6 border-t">
        <SdkUsageCanvasButton />
      </Box>
      <Box className="shrink-0 border-gray-6 border-t">
        <PrimitivesDemoApiButton />
      </Box>
      <Box className="shrink-0 border-gray-6 border-t">
        <GeneratedCanvasButton />
      </Box>
      {archivedTaskIds.size > 0 && (
        <Box className="shrink-0 border-gray-6 border-t">
          <button
            type="button"
            className="flex w-full items-center gap-1 bg-transparent px-2 py-1.5 text-left text-[13px] text-gray-11 transition-colors hover:bg-gray-3"
            onClick={navigateToArchived}
          >
            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-gray-10">
              <ArchiveIcon size={14} />
            </span>
            <span className="text-gray-11">Archived</span>
          </button>
        </Box>
      )}
      <Box p="2" className="shrink-0 border-gray-6 border-t">
        <ProjectSwitcher />
      </Box>
    </Flex>
  );
};
