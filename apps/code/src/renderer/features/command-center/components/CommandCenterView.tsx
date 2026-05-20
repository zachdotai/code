import { RtsMapView } from "@features/rts/components/RtsMapView";
import { useRtsViewStore } from "@features/rts/stores/rtsViewStore";
import { useTaskViewed } from "@features/sidebar/hooks/useTaskViewed";
import { useFeatureFlag } from "@hooks/useFeatureFlag";
import { useSetHeaderContent } from "@hooks/useSetHeaderContent";
import { Lightning } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { RTS_FLAG } from "@shared/constants";
import { useEffect, useMemo } from "react";
import { useCommandCenterData } from "../hooks/useCommandCenterData";
import { useCommandCenterStore } from "../stores/commandCenterStore";
import { CommandCenterGrid } from "./CommandCenterGrid";
import { CommandCenterToolbar } from "./CommandCenterToolbar";

export function CommandCenterView() {
  const layout = useCommandCenterStore((s) => s.layout);
  const viewMode = useCommandCenterStore((s) => s.viewMode);
  const rtsEnabled = useFeatureFlag(RTS_FLAG, import.meta.env.DEV);
  const isMap = rtsEnabled && viewMode === "map";
  const rtsFullscreen = useRtsViewStore((s) => s.fullscreen);

  const { cells, summary } = useCommandCenterData();
  const { markAsViewed } = useTaskViewed();

  const visibleTaskIdsKey = isMap
    ? ""
    : cells
        .map((c) => c.taskId)
        .filter(Boolean)
        .join(",");

  useEffect(() => {
    if (!visibleTaskIdsKey) return;
    for (const taskId of visibleTaskIdsKey.split(",")) {
      markAsViewed(taskId);
    }
  }, [visibleTaskIdsKey, markAsViewed]);

  const headerContent = useMemo(
    () => (
      <Flex align="center" gap="2" className="w-full min-w-0">
        <Lightning size={12} className="shrink-0 text-gray-10" />
        <Text
          className="truncate whitespace-nowrap font-medium text-[13px]"
          title="Command Center"
        >
          Command Center
        </Text>
      </Flex>
    ),
    [],
  );

  useSetHeaderContent(headerContent);

  return (
    <Flex direction="column" height="100%">
      {!rtsFullscreen && (
        <CommandCenterToolbar summary={summary} cells={cells} />
      )}
      <Box className="min-h-0 flex-1">
        {isMap ? (
          <RtsMapView />
        ) : (
          <CommandCenterGrid layout={layout} cells={cells} />
        )}
      </Box>
    </Flex>
  );
}
