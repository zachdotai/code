import { useFolders } from "@features/folders/hooks/useFolders";
import { TaskLogsPanel } from "@features/task-detail/components/TaskLogsPanel";
import { useTasks } from "@features/tasks/hooks/useTasks";
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  LightbulbIcon,
  Play,
  Trash,
} from "@phosphor-icons/react";
import { Box, Button, Flex, Spinner, Text } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import { useWorkSkillsStore } from "@stores/workSkillsStore";
import { useState } from "react";
import { getCatalogById } from "../data/skillsCatalog";
import { runWorkSkill } from "../utils/runWorkSkill";

export function WorkSkillDetailView() {
  const selectedSkillId = useNavigationStore((s) => s.workSelectedSkillId);
  const navigateToWorkHome = useNavigationStore((s) => s.navigateToWorkHome);
  const navigateToWorkLibrary = useNavigationStore(
    (s) => s.navigateToWorkLibrary,
  );

  const skill = useWorkSkillsStore((s) =>
    selectedSkillId ? s.getSkill(selectedSkillId) : undefined,
  );
  const updateSkill = useWorkSkillsStore((s) => s.updateSkill);
  const deleteSkill = useWorkSkillsStore((s) => s.deleteSkill);

  const { folders } = useFolders();

  const { data: tasks } = useTasks(undefined, { enabled: !!skill?.taskId });
  const task = skill?.taskId
    ? tasks?.find((t) => t.id === skill.taskId)
    : undefined;

  const [isStarting, setIsStarting] = useState(false);

  if (!skill) {
    navigateToWorkHome();
    return null;
  }

  if (skill.isSeed) {
    return (
      <Flex
        direction="column"
        align="center"
        justify="center"
        className="h-full w-full"
        px="4"
      >
        <Box className="w-full max-w-[560px]">
          <Flex align="center" gap="2" mb="3">
            <LightbulbIcon size={20} weight="fill" />
            <Text
              as="div"
              weight="medium"
              className="text-(--gray-12) text-[18px]"
            >
              {skill.name}
            </Text>
          </Flex>
          <Box className="rounded-(--radius-3) border border-(--gray-5) bg-(--color-panel-solid) p-4">
            <Text
              as="div"
              className="text-(--gray-10) text-[11px] uppercase tracking-wide"
            >
              What this skill does
            </Text>
            <Text as="div" mt="2" className="text-(--gray-12) text-[14px]">
              {skill.prompt}
            </Text>
          </Box>
          <Text
            as="div"
            mt="3"
            className="text-center text-(--gray-10) text-[12px]"
          >
            This is an example skill. Create your own with "New skill".
          </Text>
        </Box>
      </Flex>
    );
  }

  // Catalog skill activated but not yet run — show a normie-friendly
  // explanation + a big Run now CTA. Once a task is started, fall through to
  // the TaskLogsPanel branch below.
  if (skill.catalogId && !skill.taskId) {
    const catalog = getCatalogById(skill.catalogId);
    const Icon = catalog?.icon ?? LightbulbIcon;

    const handleRun = async () => {
      if (isStarting) return;
      setIsStarting(true);
      await runWorkSkill({
        prompt: skill.prompt,
        folders: folders.map((f) => f.path),
        onTaskCreated: (taskId) => {
          updateSkill(skill.id, { taskId });
        },
        failureLabel: "Failed to start skill",
      });
      setIsStarting(false);
    };

    const handleDisable = () => {
      deleteSkill(skill.id);
      navigateToWorkLibrary();
    };

    return (
      <Box className="scrollbar-overlay-y h-full w-full overflow-y-auto">
        <Flex
          direction="column"
          gap="5"
          className="mx-auto w-full max-w-[640px] px-6 pt-6 pb-12"
        >
          <Flex align="center" justify="between" gap="2">
            <button
              type="button"
              onClick={navigateToWorkLibrary}
              className="flex items-center gap-1 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-2.5 py-1 text-(--gray-11) text-[12px] transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) hover:text-(--gray-12)"
            >
              <ArrowLeft size={12} weight="bold" />
              Back to library
            </button>
            <button
              type="button"
              onClick={handleDisable}
              className="flex items-center gap-1 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-2.5 py-1 text-(--gray-11) text-[12px] transition-colors hover:border-(--red-7) hover:bg-(--red-2) hover:text-(--red-11)"
            >
              <Trash size={12} weight="bold" />
              Remove skill
            </button>
          </Flex>

          <Flex
            direction="column"
            align="center"
            gap="3"
            className="text-center"
          >
            <Box className="flex h-14 w-14 items-center justify-center rounded-(--radius-4) border border-(--gray-5) bg-(--gray-2) text-(--gray-11)">
              <Icon size={28} weight="duotone" />
            </Box>
            <Box>
              <Text
                as="div"
                weight="medium"
                className="text-(--gray-12) text-[22px]"
              >
                {skill.name}
              </Text>
              {catalog && (
                <Text
                  as="div"
                  mt="1"
                  className="mx-auto max-w-[480px] text-(--gray-11) text-[14px]"
                >
                  {catalog.outcome}
                </Text>
              )}
            </Box>

            {catalog && (
              <Flex align="center" gap="2" mt="1">
                <Box className="flex items-center gap-1 rounded-full border border-(--gray-5) bg-(--gray-1) px-2.5 py-1 text-(--gray-11) text-[11px]">
                  <Clock size={11} weight="bold" />
                  {catalog.estimatedTime}
                </Box>
              </Flex>
            )}
          </Flex>

          {catalog && (
            <Box className="rounded-(--radius-3) border border-(--gray-5) bg-(--color-panel-solid) p-4">
              <Text
                as="div"
                className="text-(--gray-10) text-[11px] uppercase tracking-wide"
              >
                When you click run, this skill will:
              </Text>
              <Flex direction="column" gap="2" mt="3">
                {catalog.steps.map((step, idx) => (
                  <Flex key={step} align="start" gap="3">
                    <Box className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--gray-3) font-medium text-(--gray-11) text-[11px]">
                      {idx + 1}
                    </Box>
                    <Text
                      as="div"
                      className="text-(--gray-12) text-[13px] leading-snug"
                    >
                      {step}
                    </Text>
                  </Flex>
                ))}
              </Flex>
            </Box>
          )}

          {catalog && catalog.needs.length > 0 && (
            <Box className="rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-3">
              <Text
                as="div"
                className="text-(--gray-10) text-[11px] uppercase tracking-wide"
              >
                Before you run
              </Text>
              <Flex direction="column" gap="1" mt="2">
                {catalog.needs.map((need) => (
                  <Flex key={need} align="center" gap="2">
                    <CheckCircle
                      size={14}
                      weight="duotone"
                      className="shrink-0 text-(--green-10)"
                    />
                    <Text as="div" className="text-(--gray-12) text-[13px]">
                      {need}
                    </Text>
                  </Flex>
                ))}
              </Flex>
            </Box>
          )}

          <Flex align="center" justify="center" gap="2">
            <Button
              size="3"
              onClick={() => void handleRun()}
              loading={isStarting}
              disabled={isStarting}
            >
              <Play size={16} weight="fill" />
              Run now
            </Button>
          </Flex>

          <Text as="div" className="text-center text-(--gray-10) text-[12px]">
            You'll see live progress here once it starts. You can stop the run
            anytime.
          </Text>
        </Flex>
      </Box>
    );
  }

  if (!skill.taskId || !task) {
    return (
      <Flex align="center" justify="center" gap="2" className="h-full w-full">
        <Spinner size="2" />
        <Text className="text-(--gray-11) text-[13px]">Starting skill…</Text>
      </Flex>
    );
  }

  return <TaskLogsPanel taskId={task.id} task={task} />;
}
