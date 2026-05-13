import { MarkdownRenderer } from "@features/editor/components/MarkdownRenderer";
import { ExternalAppsOpener } from "@features/task-detail/components/ExternalAppsOpener";
import { ArrowClockwise, PencilSimple, X } from "@phosphor-icons/react";
import { Badge, Box, Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@utils/toast";
import { useEffect, useRef, useState } from "react";
import { useMemoryStore } from "../stores/memoryStore";

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n/);
  return match ? content.slice(match[0].length).trimStart() : content;
}

interface MemoryDetailPanelProps {
  relativePath: string;
  name: string;
  type: string;
  absolutePath: string;
  onClose: () => void;
}

export function MemoryDetailPanel({
  relativePath,
  name,
  type,
  absolutePath,
  onClose,
}: MemoryDetailPanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const editMode = useMemoryStore((s) => s.editMode);
  const setEditMode = useMemoryStore((s) => s.setEditMode);
  const recentlyTouched = useMemoryStore((s) => s.recentlyTouched);
  const clearTouched = useMemoryStore((s) => s.clearTouched);
  const isNew = recentlyTouched.has(relativePath);

  const { data: fileContent, isLoading } = useQuery(
    trpc.memory.get.queryOptions({ relativePath }, { staleTime: 5_000 }),
  );

  const writeMutation = useMutation(trpc.memory.write.mutationOptions());

  const [draftContent, setDraftContent] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editMode && fileContent !== undefined) {
      setDraftContent(fileContent);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [editMode, fileContent]);

  useEffect(() => {
    if (!isNew) return;
    const timer = setTimeout(() => clearTouched(relativePath), 3000);
    return () => clearTimeout(timer);
  }, [isNew, relativePath, clearTouched]);

  const handleSave = async () => {
    try {
      await writeMutation.mutateAsync({ relativePath, content: draftContent });
      await queryClient.invalidateQueries({ queryKey: ["memory"] });
      setEditMode(false);
      toast.success("Saved");
    } catch {
      toast.error("Failed to save");
    }
  };

  const handleCancel = () => {
    setEditMode(false);
    setDraftContent("");
  };

  const body = fileContent ? stripFrontmatter(fileContent) : null;

  return (
    <>
      <Flex
        direction="column"
        gap="2"
        px="3"
        py="2"
        className="shrink-0 border-b border-b-(--gray-5)"
      >
        <Flex align="start" justify="between" gap="2">
          <Flex align="center" gap="2" className="min-w-0 flex-1">
            {isNew && (
              <span
                className="size-2 shrink-0 rounded-full bg-blue-9"
                title="Recently updated by agent"
              />
            )}
            <Text className="block min-w-0 break-words font-medium text-[13px]">
              {name}
            </Text>
          </Flex>
          <Flex align="center" gap="1" className="shrink-0">
            {!editMode && (
              <button
                type="button"
                onClick={() => setEditMode(true)}
                className="rounded p-0.5 text-gray-11 hover:bg-gray-3 hover:text-gray-12"
                title="Edit"
              >
                <PencilSimple size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded p-0.5 text-gray-11 hover:bg-gray-3 hover:text-gray-12"
            >
              <X size={14} />
            </button>
          </Flex>
        </Flex>

        <Flex align="center" gap="2" wrap="wrap">
          <Badge size="1" variant="soft" color={typeColor(type)}>
            {type}
          </Badge>
          <ExternalAppsOpener targetPath={absolutePath} />
        </Flex>
      </Flex>

      {editMode ? (
        <Flex direction="column" className="min-h-0 flex-1">
          <textarea
            ref={textareaRef}
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[13px] text-gray-12 outline-none"
            spellCheck={false}
          />
          <Flex
            align="center"
            justify="end"
            gap="2"
            px="3"
            py="2"
            className="shrink-0 border-t border-t-(--gray-5)"
          >
            <button
              type="button"
              onClick={handleCancel}
              className="rounded px-2 py-1 text-[12px] text-gray-11 hover:bg-gray-3"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={writeMutation.isPending}
              className="flex items-center gap-1 rounded bg-gray-12 px-2 py-1 text-[12px] text-gray-1 hover:opacity-90 disabled:opacity-50"
            >
              {writeMutation.isPending && (
                <ArrowClockwise size={10} className="animate-spin" />
              )}
              Save
            </button>
          </Flex>
        </Flex>
      ) : (
        <ScrollArea
          type="auto"
          scrollbars="vertical"
          className="scroll-area-constrain-width h-full"
        >
          <Flex direction="column" gap="3" p="3">
            {isLoading ? (
              <Text className="text-[12px] text-gray-9">Loading...</Text>
            ) : body ? (
              <Box className="rounded border border-gray-5 bg-gray-1 px-4 py-3 text-[13px]">
                <MarkdownRenderer content={body} />
              </Box>
            ) : (
              <Text className="text-[12px] text-gray-9">Empty file</Text>
            )}
          </Flex>
        </ScrollArea>
      )}
    </>
  );
}

function typeColor(
  type: string,
): "blue" | "green" | "orange" | "purple" | "gray" | "teal" {
  const map: Record<
    string,
    "blue" | "green" | "orange" | "purple" | "gray" | "teal"
  > = {
    person: "blue",
    context: "green",
    project: "orange",
    glossary: "purple",
    preference: "teal",
    reference: "gray",
    feedback: "orange",
  };
  return map[type] ?? "gray";
}
