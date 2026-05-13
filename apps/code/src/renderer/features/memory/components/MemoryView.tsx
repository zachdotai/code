import { ResizableSidebar } from "@components/ResizableSidebar";
import { useSetHeaderContent } from "@hooks/useSetHeaderContent";
import { Brain, Gear, ShareNetwork } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@utils/toast";
import { useMemo, useState } from "react";
import { useMemoryEntries, useMemoryRoot } from "../hooks/useMemoryEntries";
import { useMemoryWatcher } from "../hooks/useMemoryWatcher";
import { useMemoryStore } from "../stores/memoryStore";
import { MemoryDetailPanel } from "./MemoryDetailPanel";
import { MemoryGraph } from "./MemoryGraph";
import { MemoryLibrary } from "./MemoryLibrary";

const DETAIL_PANEL_WIDTH = 340;

export function MemoryView() {
  useMemoryWatcher();

  const { data: entries = [] } = useMemoryEntries();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: currentRoot } = useMemoryRoot();
  const [customRoot, setCustomRoot] = useState("");

  const selectedPath = useMemoryStore((s) => s.selectedPath);
  const selectEntry = useMemoryStore((s) => s.selectEntry);
  const activeTab = useMemoryStore((s) => s.activeTab);
  const setActiveTab = useMemoryStore((s) => s.setActiveTab);

  const [detailWidth, setDetailWidth] = useState(DETAIL_PANEL_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  const setRootMutation = useMutation(trpc.memory.setRoot.mutationOptions());

  const selectedEntry = useMemo(
    () =>
      selectedPath
        ? entries.find((e) => e.relativePath === selectedPath)
        : null,
    [entries, selectedPath],
  );

  const headerContent = useMemo(
    () => (
      <Flex align="center" gap="2" className="w-full min-w-0">
        <Brain size={12} className="shrink-0 text-gray-10" />
        <Text
          className="truncate whitespace-nowrap font-medium text-[13px]"
          title="Memory"
        >
          Memory
        </Text>
      </Flex>
    ),
    [],
  );

  useSetHeaderContent(headerContent);

  const handleSetRoot = async () => {
    const trimmed = customRoot.trim();
    if (!trimmed) return;
    try {
      await setRootMutation.mutateAsync({ root: trimmed });
      await queryClient.invalidateQueries({ queryKey: ["memory"] });
      setCustomRoot("");
      toast.success("Memory root updated");
    } catch {
      toast.error("Failed to update memory root");
    }
  };

  return (
    <Flex direction="column" height="100%" className="overflow-hidden">
      <Flex
        align="center"
        gap="1"
        px="3"
        className="shrink-0 border-b border-b-(--gray-5) py-1.5"
      >
        <TabButton
          icon={<Brain size={13} />}
          label="Library"
          active={activeTab === "library"}
          onClick={() => setActiveTab("library")}
        />
        <TabButton
          icon={<ShareNetwork size={13} />}
          label="Graph"
          active={activeTab === "graph"}
          onClick={() => setActiveTab("graph")}
        />
        <TabButton
          icon={<Gear size={13} />}
          label="Settings"
          active={activeTab === "settings"}
          onClick={() => setActiveTab("settings")}
        />
      </Flex>

      <Flex className="min-h-0 flex-1">
        {activeTab === "library" && (
          <>
            <Box flexGrow="1" className="min-w-0">
              <MemoryLibrary />
            </Box>
            <ResizableSidebar
              open={!!selectedEntry}
              width={detailWidth}
              setWidth={setDetailWidth}
              isResizing={isResizing}
              setIsResizing={setIsResizing}
              side="right"
            >
              {selectedEntry && (
                <MemoryDetailPanel
                  relativePath={selectedEntry.relativePath}
                  name={selectedEntry.name}
                  type={selectedEntry.type}
                  absolutePath={selectedEntry.absolutePath}
                  onClose={() => selectEntry(null)}
                />
              )}
            </ResizableSidebar>
          </>
        )}

        {activeTab === "graph" && (
          <>
            <Box flexGrow="1" className="min-w-0">
              <MemoryGraph />
            </Box>
            <ResizableSidebar
              open={!!selectedEntry}
              width={detailWidth}
              setWidth={setDetailWidth}
              isResizing={isResizing}
              setIsResizing={setIsResizing}
              side="right"
            >
              {selectedEntry && (
                <MemoryDetailPanel
                  relativePath={selectedEntry.relativePath}
                  name={selectedEntry.name}
                  type={selectedEntry.type}
                  absolutePath={selectedEntry.absolutePath}
                  onClose={() => selectEntry(null)}
                />
              )}
            </ResizableSidebar>
          </>
        )}

        {activeTab === "settings" && (
          <Box flexGrow="1" className="p-4">
            <Flex direction="column" gap="4" className="max-w-md">
              <Box>
                <Text className="mb-1 block font-medium text-[13px]">
                  Memory root directory
                </Text>
                <Text className="mb-3 block text-[12px] text-gray-10">
                  Where your memory files live. Default:{" "}
                  <code className="rounded bg-gray-3 px-1 py-0.5 text-[11px]">
                    ~/.claude/memory/
                  </code>
                </Text>
                {currentRoot && (
                  <Text className="mb-2 block rounded bg-gray-3 px-2 py-1.5 font-mono text-[12px] text-gray-11">
                    {currentRoot}
                  </Text>
                )}
                <Flex gap="2">
                  <input
                    type="text"
                    placeholder="/path/to/your/memory/folder"
                    value={customRoot}
                    onChange={(e) => setCustomRoot(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSetRoot()}
                    className="flex-1 rounded border border-gray-5 bg-transparent px-2 py-1.5 text-[13px] text-gray-12 outline-none focus:border-gray-8"
                  />
                  <button
                    type="button"
                    onClick={handleSetRoot}
                    disabled={!customRoot.trim() || setRootMutation.isPending}
                    className="rounded bg-gray-12 px-3 py-1.5 text-[12px] text-gray-1 hover:opacity-90 disabled:opacity-40"
                  >
                    Apply
                  </button>
                </Flex>
              </Box>

              <Box className="rounded border border-gray-5 bg-gray-2 p-3">
                <Text className="mb-1 block font-medium text-[13px]">
                  Agent access
                </Text>
                <Text className="text-[12px] text-gray-10">
                  The agent reads{" "}
                  <code className="rounded bg-gray-3 px-1 py-0.5 text-[11px]">
                    MEMORY.md
                  </code>{" "}
                  at the start of each task and can read/write individual
                  entries during the session. Changes appear here in real time.
                </Text>
              </Box>
            </Flex>
          </Box>
        )}
      </Flex>
    </Flex>
  );
}

function TabButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded px-2 py-1 text-[12px] transition-colors ${
        active
          ? "bg-gray-3 font-medium text-gray-12"
          : "text-gray-10 hover:bg-gray-3 hover:text-gray-11"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
