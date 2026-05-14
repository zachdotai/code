import { Briefcase, X } from "@phosphor-icons/react";
import { Box, Button, Flex, IconButton, Text } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";

interface TryInPostHogWorkBannerProps {
  onDismiss: () => void;
}

export function TryInPostHogWorkBanner({
  onDismiss,
}: TryInPostHogWorkBannerProps) {
  const setMode = useNavigationStore((s) => s.setMode);
  const navigateToWorkHome = useNavigationStore((s) => s.navigateToWorkHome);

  const goToNewTask = () => {
    setMode("work");
    navigateToWorkHome();
  };

  return (
    <Box className="mb-3 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-2) px-4 py-3">
      <Flex align="center" gap="4">
        <Flex
          align="center"
          justify="center"
          className="size-9 shrink-0 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1)"
        >
          <Briefcase size={18} className="text-(--gray-11)" />
        </Flex>
        <Box className="min-w-0 flex-1">
          <Text
            as="div"
            weight="medium"
            className="text-(--gray-12) text-[13px]"
          >
            Try this in PostHog Work
          </Text>
          <Text as="div" className="text-(--gray-11) text-[12px]">
            Looks like you're trying to generate shareholder value. Try
            continuing this task in PostHog Work.
          </Text>
        </Box>
        <Button
          size="2"
          variant="solid"
          color="gray"
          highContrast
          onClick={goToNewTask}
        >
          <Text className="px-2 text-[12px]">Try in PostHog Work</Text>
        </Button>
        <IconButton
          size="1"
          variant="ghost"
          color="gray"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          <X size={14} />
        </IconButton>
      </Flex>
    </Box>
  );
}
