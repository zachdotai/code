import { ResizableSidebar } from "@components/ResizableSidebar";
import { useSetHeaderContent } from "@hooks/useSetHeaderContent";
import { Brain, FileText, Gear, House, Warning } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@utils/toast";
import { useMemo, useState } from "react";
import { useMemoryEntries, useMemoryRoot } from "../hooks/useMemoryEntries";
import { useMemoryWatcher } from "../hooks/useMemoryWatcher";
import { useMemoryStore } from "../stores/memoryStore";
import { MemoryDetailPanel } from "./MemoryDetailPanel";
import { MemoryHome } from "./MemoryHome";
import { MemoryLibrary } from "./MemoryLibrary";
import { MemoryQuestionnaire } from "./MemoryQuestionnaire";

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
  const clearAllMutation = useMutation(trpc.memory.clearAll.mutationOptions());
  const [skippedOnboarding, setSkippedOnboarding] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const needsOnboarding =
    !skippedOnboarding &&
    entries.length <= 1 &&
    !entries.some((e) => e.type === "person");

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

  const handleClearAll = async () => {
    try {
      await clearAllMutation.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ["memory"] });
      selectEntry(null);
      setSkippedOnboarding(false);
      setShowClearConfirm(false);
      setClearConfirmText("");
      setActiveTab("home");
      toast.success("Memory cleared");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to clear memory: ${msg}`);
    }
  };

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
          icon={<House size={13} />}
          label="Home"
          active={activeTab === "home"}
          onClick={() => setActiveTab("home")}
        />
        <TabButton
          icon={<FileText size={13} />}
          label="Files"
          active={activeTab === "files"}
          onClick={() => setActiveTab("files")}
        />
        <TabButton
          icon={<Gear size={13} />}
          label="Settings"
          active={activeTab === "settings"}
          onClick={() => setActiveTab("settings")}
        />
      </Flex>

      <Flex className="min-h-0 flex-1">
        {activeTab === "home" && needsOnboarding && (
          <Box flexGrow="1" className="min-w-0">
            <MemoryQuestionnaire
              onComplete={() => setSkippedOnboarding(true)}
              onSkip={() => setSkippedOnboarding(true)}
            />
          </Box>
        )}

        {activeTab === "home" && !needsOnboarding && (
          <Box flexGrow="1" className="min-w-0">
            <MemoryHome />
          </Box>
        )}

        {activeTab === "files" && (
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

              <Box className="mt-2 rounded border border-red-6 bg-(--red-2) p-3">
                <Flex align="center" gap="2" className="mb-2">
                  <Warning size={14} className="text-red-10" />
                  <Text className="font-medium text-[13px] text-red-11">
                    Danger zone
                  </Text>
                </Flex>
                <Text className="mb-3 block text-[12px] text-gray-11">
                  Clear all memory entries (MEMORY.md, all people, every other
                  entry). The folder is reset to a fresh starter index. This
                  cannot be undone.
                </Text>

                {!showClearConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowClearConfirm(true)}
                    className="rounded border border-red-7 bg-transparent px-3 py-1.5 text-[12px] text-red-11 hover:bg-(--red-3)"
                  >
                    Clear memory…
                  </button>
                ) : (
                  <Flex direction="column" gap="2">
                    <Text className="text-[12px] text-gray-11">
                      Type{" "}
                      <code className="rounded bg-gray-3 px-1 py-0.5 text-[11px]">
                        clear memory
                      </code>{" "}
                      to confirm.
                    </Text>
                    <input
                      type="text"
                      value={clearConfirmText}
                      onChange={(e) => setClearConfirmText(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          clearConfirmText.trim().toLowerCase() ===
                            "clear memory"
                        ) {
                          handleClearAll();
                        }
                      }}
                      placeholder="clear memory"
                      className="w-full rounded border border-red-7 bg-transparent px-2 py-1.5 text-[13px] text-gray-12 outline-none focus:border-red-9"
                    />
                    <Flex gap="2" justify="end">
                      <button
                        type="button"
                        onClick={() => {
                          setShowClearConfirm(false);
                          setClearConfirmText("");
                        }}
                        className="rounded px-3 py-1.5 text-[12px] text-gray-10 hover:bg-gray-3 hover:text-gray-11"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleClearAll}
                        disabled={
                          clearConfirmText.trim().toLowerCase() !==
                            "clear memory" || clearAllMutation.isPending
                        }
                        className="rounded bg-(--red-9) px-3 py-1.5 text-[12px] text-gray-1 hover:opacity-90 disabled:opacity-40"
                      >
                        Clear everything
                      </button>
                    </Flex>
                  </Flex>
                )}
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
