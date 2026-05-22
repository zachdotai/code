import { McpAppHost } from "@features/mcp-apps/components/McpAppHost";
import { useMcpAppsSidebarStore } from "@features/sessions/stores/mcpAppsSidebarStore";
import type { ToolCall, ToolCallStatus } from "@features/sessions/types";
import { ArrowSquareOut, X } from "@phosphor-icons/react";
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";

export interface McpAppEntry {
  itemIndex: number;
  toolCallId: string;
  fullToolName: string;
  serverName: string;
  toolName: string;
  title?: string;
  status?: ToolCallStatus | null;
  toolCall: ToolCall;
}

interface McpAppsSidebarProps {
  entries: readonly McpAppEntry[];
  onSelect: (itemIndex: number) => void;
}

const MIN_WIDTH = 280;
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

export function McpAppsSidebar({ entries, onSelect }: McpAppsSidebarProps) {
  const widthRatio = useMcpAppsSidebarStore((s) => s.widthRatio);
  const setWidthRatio = useMcpAppsSidebarStore((s) => s.setWidthRatio);
  const setOpen = useMcpAppsSidebarStore((s) => s.setOpen);
  const isResizing = useMcpAppsSidebarStore((s) => s.isResizing);
  const setIsResizing = useMcpAppsSidebarStore((s) => s.setIsResizing);

  const outerRef = useRef<HTMLDivElement>(null);
  const [parentWidth, setParentWidth] = useState(0);

  useEffect(() => {
    const parent = outerRef.current?.parentElement;
    if (!parent) return;
    setParentWidth(parent.getBoundingClientRect().width);
    const observer = new ResizeObserver((observed) => {
      for (const entry of observed) {
        setParentWidth(entry.contentRect.width);
      }
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const ratioMin = parentWidth > 0 ? MIN_WIDTH / parentWidth : MIN_RATIO;
  const effectiveRatio = Math.min(
    MAX_RATIO,
    Math.max(Math.min(ratioMin, MAX_RATIO), widthRatio),
  );
  const width =
    parentWidth > 0
      ? Math.round(parentWidth * effectiveRatio)
      : Math.round(MIN_WIDTH);

  const startXRef = useRef(0);
  const startWidthRef = useRef(width);
  const startParentWidthRef = useRef(parentWidth);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      startParentWidthRef.current = parentWidth;
      setIsResizing(true);
    },
    [width, parentWidth, setIsResizing],
  );

  useEffect(() => {
    if (!isResizing) return;
    const onMouseMove = (e: MouseEvent) => {
      const delta = startXRef.current - e.clientX;
      const parent = startParentWidthRef.current;
      if (parent <= 0) return;
      const nextPx = startWidthRef.current + delta;
      const nextRatio = Math.min(
        MAX_RATIO,
        Math.max(MIN_WIDTH / parent, nextPx / parent),
      );
      setWidthRatio(nextRatio);
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
  }, [isResizing, setIsResizing, setWidthRatio]);

  return (
    <>
      <Box
        onMouseDown={handleResizeStart}
        className="z-[1] w-[4px] shrink-0 cursor-col-resize border-l border-l-(--gray-6) bg-transparent transition-colors hover:bg-accent-6 active:bg-accent-8"
      />
      <Box
        ref={outerRef}
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
            <Flex direction="column" gap="3" className="p-3">
              {entries.map((entry) => (
                <McpAppCard
                  key={entry.toolCallId}
                  entry={entry}
                  onJump={() => onSelect(entry.itemIndex)}
                />
              ))}
            </Flex>
          )}
        </Box>
      </Box>
    </>
  );
}

function McpAppCard({
  entry,
  onJump,
}: {
  entry: McpAppEntry;
  onJump: () => void;
}) {
  const label = entry.title?.trim() || entry.toolName || entry.fullToolName;
  return (
    <Box className="overflow-hidden rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1)">
      <Flex
        align="center"
        gap="2"
        className="border-(--gray-5) border-b px-2 py-1.5"
      >
        <StatusDot status={entry.status ?? null} />
        <Flex direction="column" className="min-w-0 flex-1">
          <Text className="truncate text-(--gray-12) text-[12px]">{label}</Text>
          <Text className="truncate text-(--gray-9) text-[11px]">
            {entry.serverName} · {entry.toolName}
          </Text>
        </Flex>
        <IconButton
          size="1"
          variant="ghost"
          color="gray"
          aria-label="Jump to in conversation"
          title="Jump to in conversation"
          onClick={onJump}
        >
          <ArrowSquareOut size={12} />
        </IconButton>
      </Flex>
      <Box className="p-2">
        <McpAppHost
          toolCall={entry.toolCall}
          mcpToolName={entry.fullToolName}
          serverName={entry.serverName}
          toolName={entry.toolName}
        />
      </Box>
    </Box>
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
