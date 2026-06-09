import { ArrowRightIcon } from "@phosphor-icons/react";
import {
  inboxOnboardingProgress,
  useInboxOnboardingState,
} from "@posthog/ui/features/inbox/components/onboarding/useInboxOnboardingState";
import { Flex, Text } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";

/**
 * Slim sticky strip shown above the Agents view's config when the inbox
 * is still being onboarded. Points back to the Inbox takeover.
 */
export function InboxOnboardingCallout() {
  const state = useInboxOnboardingState();
  if (state.isLoading || state.isComplete) return null;
  const progress = inboxOnboardingProgress(state);

  return (
    <Link
      to="/code/inbox/pulls"
      className="group block border-gray-5 border-b bg-(--amber-2) px-6 py-2.5 no-underline transition-colors hover:bg-(--amber-3)"
    >
      <Flex
        align="center"
        gap="3"
        className="cursor-default select-none text-[12.5px]"
      >
        <Text className="font-medium text-gray-12">
          Finish setting up your inbox
        </Text>
        <Text className="text-gray-11 tabular-nums">
          {progress.doneCount} of {progress.totalCount} done
        </Text>
        <span className="flex-1" />
        <Flex
          align="center"
          gap="1"
          className="font-medium text-gray-11 group-hover:text-gray-12"
        >
          <span>Continue</span>
          <ArrowRightIcon
            size={12}
            className="transition-transform group-hover:translate-x-0.5"
          />
        </Flex>
      </Flex>
    </Link>
  );
}
