import {
  MagnifyingGlass,
  Sparkle,
  SquaresFour,
  X as XIcon,
} from "@phosphor-icons/react";
import { Box, Dialog, Flex, Text, TextField } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import { useNavigationStore } from "@stores/navigationStore";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@utils/toast";
import { useMemo, useState } from "react";
import { PROJECT_ICON_MAP } from "../canvas/icons";
import { createProjectFromTemplate } from "../canvas/useProjectCanvas";

type TemplateCategory =
  | "growth"
  | "engineering"
  | "product"
  | "ops"
  | "research"
  | "all";

const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  all: "All",
  growth: "Growth",
  engineering: "Engineering",
  product: "Product",
  ops: "Ops",
  research: "Research",
};

const CATEGORY_ORDER: TemplateCategory[] = [
  "all",
  "growth",
  "product",
  "research",
  "engineering",
  "ops",
];

interface TemplateGalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TemplateGallery({ open, onOpenChange }: TemplateGalleryProps) {
  const trpc = useTRPC();
  const navigateToWorkProjectDetail = useNavigationStore(
    (s) => s.navigateToWorkProjectDetail,
  );
  const [category, setCategory] = useState<TemplateCategory>("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery(
    trpc.workProjects.listTemplates.queryOptions(),
  );

  const filtered = useMemo(() => {
    const list = templates ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((t) => {
      if (category !== "all" && t.category !== category) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.tagline.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      );
    });
  }, [templates, category, search]);

  const handlePick = async (templateId: string) => {
    if (creating) return;
    setCreating(templateId);
    try {
      const project = await createProjectFromTemplate(templateId);
      onOpenChange(false);
      navigateToWorkProjectDetail(project.id);
    } catch (err) {
      toast.error("Couldn't create project", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setCreating(null);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        maxWidth="880px"
        size="3"
        className="relative max-h-[80vh] overflow-hidden p-0"
      >
        <Flex direction="column" className="max-h-[80vh]">
          {/* Header */}
          <Flex
            align="center"
            justify="between"
            gap="3"
            className="shrink-0 border-(--gray-5) border-b px-5 py-4"
          >
            <Flex align="center" gap="2">
              <Sparkle
                size={16}
                weight="duotone"
                className="text-(--accent-10)"
              />
              <Dialog.Title className="m-0 font-medium text-(--gray-12) text-[15px]">
                Start a project
              </Dialog.Title>
            </Flex>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="-mr-1 flex h-7 w-7 items-center justify-center rounded-(--radius-2) text-(--gray-10) transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
            >
              <XIcon size={14} weight="bold" />
            </button>
          </Flex>

          {/* Filters */}
          <Flex
            align="center"
            gap="2"
            className="shrink-0 border-(--gray-5) border-b px-5 py-3"
          >
            <Box className="w-[260px]">
              <TextField.Root
                size="2"
                placeholder="Search templates"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              >
                <TextField.Slot>
                  <MagnifyingGlass size={14} weight="regular" />
                </TextField.Slot>
              </TextField.Root>
            </Box>
            <Flex align="center" gap="1" wrap="wrap">
              {CATEGORY_ORDER.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`rounded-full px-3 py-1 text-[12px] transition-colors ${
                    category === c
                      ? "bg-(--gray-12) text-(--gray-1)"
                      : "text-(--gray-11) hover:bg-(--gray-3) hover:text-(--gray-12)"
                  }`}
                >
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </Flex>
          </Flex>

          {/* Body */}
          <Box className="scrollbar-overlay-y min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {isLoading ? (
              <Text as="div" className="text-(--gray-11) text-[13px]">
                Loading templates…
              </Text>
            ) : filtered.length === 0 ? (
              <Flex
                direction="column"
                align="center"
                gap="2"
                className="rounded-(--radius-3) border border-(--gray-5) border-dashed bg-(--gray-1) px-6 py-12"
              >
                <SquaresFour
                  size={20}
                  weight="duotone"
                  className="text-(--gray-10)"
                />
                <Text
                  as="div"
                  weight="medium"
                  className="text-(--gray-12) text-[13px]"
                >
                  No templates match
                </Text>
                <Text as="div" className="text-(--gray-11) text-[12px]">
                  Try a different category or clear the search.
                </Text>
              </Flex>
            ) : (
              <Box className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((t) => {
                  const Icon =
                    PROJECT_ICON_MAP[t.iconId] ?? PROJECT_ICON_MAP.lightbulb;
                  const isCreating = creating === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => void handlePick(t.id)}
                      disabled={!!creating}
                      className="group flex h-full flex-col gap-2 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-3.5 text-left transition-all hover:border-(--gray-7) hover:bg-(--gray-2) disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Flex align="center" gap="2">
                        <Flex
                          align="center"
                          justify="center"
                          className="h-7 w-7 shrink-0 rounded-(--radius-2) bg-(--gray-3) text-(--gray-11) transition-colors group-hover:bg-(--gray-4)"
                        >
                          <Icon size={14} weight="regular" />
                        </Flex>
                        <Text
                          as="div"
                          weight="medium"
                          className="truncate text-(--gray-12) text-[13px]"
                        >
                          {t.name}
                        </Text>
                      </Flex>
                      <Text
                        as="div"
                        className="line-clamp-3 text-(--gray-11) text-[12px] leading-snug"
                      >
                        {t.description}
                      </Text>
                      <Flex
                        align="center"
                        justify="between"
                        className="mt-auto"
                      >
                        <Text as="div" className="text-(--gray-10) text-[11px]">
                          {t.tileCount} {t.tileCount === 1 ? "tile" : "tiles"}
                        </Text>
                        <Text as="div" className="text-(--gray-10) text-[11px]">
                          {isCreating
                            ? "Creating…"
                            : CATEGORY_LABEL[t.category]}
                        </Text>
                      </Flex>
                    </button>
                  );
                })}
              </Box>
            )}
          </Box>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
