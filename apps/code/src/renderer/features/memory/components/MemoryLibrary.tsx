import {
  Brain,
  FilePlus,
  FolderSimple,
  MagnifyingGlass,
  User,
} from "@phosphor-icons/react";
import {
  Badge,
  Box,
  Flex,
  ScrollArea,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@utils/toast";
import { useMemo, useState } from "react";
import { useMemoryEntries } from "../hooks/useMemoryEntries";
import { useMemoryStore } from "../stores/memoryStore";

const TYPE_ORDER = [
  "person",
  "context",
  "project",
  "glossary",
  "preference",
  "reference",
  "feedback",
];

interface EntryShape {
  relativePath: string;
  name: string;
  description: string;
  type: string;
  absolutePath: string;
}

interface GroupedEntries {
  type: string;
  entries: EntryShape[];
}

export function MemoryLibrary() {
  const { data: entries = [], isLoading } = useMemoryEntries();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const selectedPath = useMemoryStore((s) => s.selectedPath);
  const selectEntry = useMemoryStore((s) => s.selectEntry);
  const recentlyTouched = useMemoryStore((s) => s.recentlyTouched);

  const [searchQuery, setSearchQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("context");

  const createMutation = useMutation(trpc.memory.create.mutationOptions());

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q),
    );
  }, [entries, searchQuery]);

  const grouped = useMemo<GroupedEntries[]>(() => {
    const map = new Map<string, GroupedEntries>();
    for (const e of filtered) {
      const existing = map.get(e.type);
      if (existing) {
        existing.entries.push(e);
      } else {
        map.set(e.type, { type: e.type, entries: [e] });
      }
    }
    const result: GroupedEntries[] = [];
    for (const t of TYPE_ORDER) {
      const g = map.get(t);
      if (g) {
        result.push(g);
        map.delete(t);
      }
    }
    for (const g of map.values()) {
      result.push(g);
    }
    return result;
  }, [filtered]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const rel = await createMutation.mutateAsync({
        name: newName.trim(),
        type: newType,
      });
      await queryClient.invalidateQueries({ queryKey: ["memory"] });
      selectEntry(rel);
      setCreating(false);
      setNewName("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create entry",
      );
    }
  };

  return (
    <Flex direction="column" className="h-full">
      <Box px="3" pt="3" pb="2">
        <TextField.Root
          size="2"
          placeholder="Search memory..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="text-[13px]"
        >
          <TextField.Slot>
            <MagnifyingGlass size={14} />
          </TextField.Slot>
        </TextField.Root>
      </Box>

      <ScrollArea type="auto" className="scroll-area-constrain-width flex-1">
        <Box px="3" pb="3">
          {entries.length === 0 && !isLoading ? (
            <Flex
              align="center"
              justify="center"
              direction="column"
              gap="3"
              className="py-12"
            >
              <Box className="rounded-lg border border-gray-6 border-dashed p-4">
                <Brain size={24} className="text-gray-8" />
              </Box>
              <Text className="text-[13px] text-gray-10">
                No memory entries yet
              </Text>
              <Text className="text-center text-[12px] text-gray-9">
                Create entries to give Claude context about you, your team, and
                your work.
              </Text>
            </Flex>
          ) : (
            <Flex direction="column" gap="4">
              {grouped.map(({ type, entries: items }) => (
                <Box key={type}>
                  <Flex align="center" gap="1.5" className="mb-1.5">
                    <TypeIcon type={type} />
                    <Text className="font-medium text-[11px] text-gray-10 uppercase tracking-wide">
                      {type}
                    </Text>
                    <Badge
                      size="1"
                      variant="soft"
                      color="gray"
                      className="ml-auto"
                    >
                      {items.length}
                    </Badge>
                  </Flex>
                  <Flex direction="column" gap="0.5">
                    {items.map((entry) => (
                      <EntryRow
                        key={entry.relativePath}
                        entry={entry}
                        isSelected={selectedPath === entry.relativePath}
                        isTouched={recentlyTouched.has(entry.relativePath)}
                        onClick={() =>
                          selectEntry(
                            entry.relativePath === selectedPath
                              ? null
                              : entry.relativePath,
                          )
                        }
                      />
                    ))}
                  </Flex>
                </Box>
              ))}
            </Flex>
          )}
        </Box>
      </ScrollArea>

      <Box className="shrink-0 border-t border-t-(--gray-5)" px="3" py="2">
        {creating ? (
          <Flex direction="column" gap="2">
            <input
              type="text"
              placeholder="Entry name..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              className="w-full rounded border border-gray-5 bg-transparent px-2 py-1 text-[13px] text-gray-12 outline-none focus:border-gray-8"
            />
            <Flex gap="2" align="center">
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                className="flex-1 rounded border border-gray-5 bg-transparent px-1.5 py-1 text-[12px] text-gray-11"
              >
                {TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!newName.trim() || createMutation.isPending}
                className="rounded bg-gray-12 px-2 py-1 text-[12px] text-gray-1 hover:opacity-90 disabled:opacity-40"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded px-2 py-1 text-[12px] text-gray-10 hover:bg-gray-3"
              >
                Cancel
              </button>
            </Flex>
          </Flex>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-[12px] text-gray-10 hover:bg-gray-3 hover:text-gray-12"
          >
            <FilePlus size={14} />
            New entry
          </button>
        )}
      </Box>
    </Flex>
  );
}

function EntryRow({
  entry,
  isSelected,
  isTouched,
  onClick,
}: {
  entry: { relativePath: string; name: string; description?: string };
  isSelected: boolean;
  isTouched: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
        isSelected
          ? "bg-gray-3 text-gray-12"
          : "text-gray-11 hover:bg-gray-3 hover:text-gray-12"
      }`}
    >
      {isTouched && (
        <span className="size-1.5 shrink-0 rounded-full bg-blue-9" />
      )}
      <span
        className={`flex-1 truncate text-[13px] ${isTouched ? "" : "pl-[7px]"}`}
      >
        {entry.name}
      </span>
      {entry.description && (
        <span className="max-w-[120px] shrink-0 truncate text-[11px] text-gray-9 group-hover:text-gray-10">
          {entry.description}
        </span>
      )}
    </button>
  );
}

function TypeIcon({ type }: { type: string }) {
  if (type === "person") return <User size={11} className="text-gray-9" />;
  if (type === "context" || type === "project")
    return <FolderSimple size={11} className="text-gray-9" />;
  return <Brain size={11} className="text-gray-9" />;
}
