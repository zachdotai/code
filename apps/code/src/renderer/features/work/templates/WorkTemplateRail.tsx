import { ArrowRight } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import { useNavigationStore } from "@stores/navigationStore";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@utils/toast";
import { useState } from "react";
import { PROJECT_ICON_MAP } from "../canvas/icons";
import { createProjectFromTemplate } from "../canvas/useProjectCanvas";
import { TemplateGallery } from "./TemplateGallery";

const FEATURED_IDS = [
  "product-market-fit-check",
  "competitor-intel",
  "power-users-to-interview",
  "weekly-slack-digest",
];

export function WorkTemplateRail() {
  const trpc = useTRPC();
  const navigateToWorkProjectDetail = useNavigationStore(
    (s) => s.navigateToWorkProjectDetail,
  );
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  const { data: templates } = useQuery(
    trpc.workProjects.listTemplates.queryOptions(),
  );

  const featured =
    templates
      ?.filter((t) => FEATURED_IDS.includes(t.id))
      .sort(
        (a, b) => FEATURED_IDS.indexOf(a.id) - FEATURED_IDS.indexOf(b.id),
      ) ?? [];

  const handlePick = async (templateId: string) => {
    if (creating) return;
    setCreating(templateId);
    try {
      const project = await createProjectFromTemplate(templateId);
      navigateToWorkProjectDetail(project.id);
    } catch (err) {
      toast.error("Couldn't create project", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setCreating(null);
    }
  };

  if (featured.length === 0) return null;

  return (
    <Box className="w-full">
      <Flex align="center" justify="between" className="mb-2">
        <Text as="div" weight="medium" className="text-(--gray-12) text-[13px]">
          Start a project
        </Text>
        <button
          type="button"
          onClick={() => setGalleryOpen(true)}
          className="flex items-center gap-1 text-(--gray-11) text-[12px] transition-colors hover:text-(--gray-12)"
        >
          Browse all
          <ArrowRight size={11} weight="bold" />
        </button>
      </Flex>
      <Box className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {featured.map((t) => {
          const Icon = PROJECT_ICON_MAP[t.iconId] ?? PROJECT_ICON_MAP.lightbulb;
          const isCreating = creating === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => void handlePick(t.id)}
              disabled={!!creating}
              className="group flex h-full min-w-0 flex-col gap-1.5 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-3 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) disabled:cursor-not-allowed disabled:opacity-60"
            >
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
              <Text
                as="div"
                className="line-clamp-2 text-(--gray-11) text-[11px] leading-snug"
              >
                {isCreating ? "Creating…" : t.tagline}
              </Text>
            </button>
          );
        })}
      </Box>
      <TemplateGallery open={galleryOpen} onOpenChange={setGalleryOpen} />
    </Box>
  );
}
