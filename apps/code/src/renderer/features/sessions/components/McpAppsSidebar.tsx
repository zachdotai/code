import { Tooltip } from "@components/ui/Tooltip";
import { useMcpAppsSidebarStore } from "@features/sessions/stores/mcpAppsSidebarStore";
import type { ToolCallStatus } from "@features/sessions/types";
import { X } from "@phosphor-icons/react";
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef } from "react";

export interface McpAppEntry {
  itemIndex: number;
  toolCallId: string;
  fullToolName: string;
  serverName: string;
  toolName: string;
  title?: string;
  inputPreview?: string;
  status?: ToolCallStatus | null;
}

interface McpAppsSidebarProps {
  entries: readonly McpAppEntry[];
  onSelect: (itemIndex: number) => void;
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export function McpAppsSidebar({ entries, onSelect }: McpAppsSidebarProps) {
  const width = useMcpAppsSidebarStore((s) => s.width);
  const setWidth = useMcpAppsSidebarStore((s) => s.setWidth);
  const setOpen = useMcpAppsSidebarStore((s) => s.setOpen);
  const isResizing = useMcpAppsSidebarStore((s) => s.isResizing);
  const setIsResizing = useMcpAppsSidebarStore((s) => s.setIsResizing);

  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      setIsResizing(true);
    },
    [width, setIsResizing],
  );

  useEffect(() => {
    if (!isResizing) return;
    const onMouseMove = (e: MouseEvent) => {
      const delta = startXRef.current - e.clientX;
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startWidthRef.current + delta),
      );
      setWidth(next);
    };
    const onMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizing, setIsResizing, setWidth]);

  return (
    <>
      <Box
        onMouseDown={handleResizeStart}
        className="z-[1] w-[4px] shrink-0 cursor-col-resize border-l border-l-(--gray-6) bg-transparent transition-colors hover:bg-accent-6 active:bg-accent-8"
      />
      <Box
        style={{ width: `${width}px` }}
        className="flex h-full shrink-0 flex-col bg-background"
      >
        <Flex
          align="center"
          justify="between"
          gap="2"
          className="border-(--gray-5) border-b px-3 py-2"
        >
          <Flex align="center" gap="2" className="min-w-0">
            <Text className="truncate font-medium text-(--gray-12) text-[13px]">
              MCP apps
            </Text>
            {entries.length > 0 && (
              <Text className="text-(--gray-9) text-[12px]">
                {entries.length}
              </Text>
            )}
          </Flex>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            aria-label="Close MCP apps sidebar"
            onClick={() => setOpen(false)}
          >
            <X size={14} weight="bold" />
          </IconButton>
        </Flex>
        <Box className="min-h-0 flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <Flex
              align="center"
              justify="center"
              className="h-full px-4 text-center"
            >
              <Text className="text-(--gray-9) text-[12px]">
                No MCP apps in this thread yet.
              </Text>
            </Flex>
          ) : (
            <Flex direction="column" className="py-1">
              {entries.map((entry) => (
                <McpAppRow
                  key={entry.toolCallId}
                  entry={entry}
                  onClick={() => onSelect(entry.itemIndex)}
                />
              ))}
            </Flex>
          )}
        </Box>
      </Box>
    </>
  );
}

function McpAppRow({
  entry,
  onClick,
}: {
  entry: McpAppEntry;
  onClick: () => void;
}) {
  const label = entry.title?.trim() || entry.toolName || entry.fullToolName;
  const subtitle = entry.inputPreview;
  return (
    <Tooltip content={label} side="left" delayDuration={400}>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-(--gray-12) text-[13px] transition-colors hover:bg-(--gray-3) focus:bg-(--gray-3) focus:outline-none"
      >
        <StatusDot status={entry.status ?? null} />
        <Flex direction="column" className="min-w-0 flex-1">
          <Text className="truncate text-(--gray-12) text-[13px]">{label}</Text>
          <Text className="truncate text-(--gray-9) text-[11px]">
            {entry.serverName}
            {subtitle ? ` · ${subtitle}` : ""}
          </Text>
        </Flex>
      </button>
    </Tooltip>
  );
}

function StatusDot({ status }: { status: ToolCallStatus | null }) {
  const color = (() => {
    switch (status) {
      case "in_progress":
      case "pending":
        return "bg-(--amber-9)";
      case "failed":
        return "bg-(--red-9)";
      case "completed":
        return "bg-(--green-9)";
      default:
        return "bg-(--gray-7)";
    }
  })();
  return <span className={`block size-2 shrink-0 rounded-full ${color}`} />;
}
