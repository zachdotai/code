import { CheckCircle, Sparkle } from "@phosphor-icons/react";
import { Button, Flex, Text } from "@radix-ui/themes";
import type { NestLifecycle } from "../../utils/nestLifecycle";

interface ValidationBannerProps {
  lifecycle: NestLifecycle;
  onMarkValidated: () => void;
}

export function ValidationBanner({
  lifecycle,
  onMarkValidated,
}: ValidationBannerProps) {
  if (lifecycle === "validating") {
    return (
      <div className="rounded-(--radius-2) border border-(--purple-7) bg-(--purple-2) p-3">
        <Flex direction="column" gap="2">
          <Flex align="center" gap="2">
            <Sparkle size={16} weight="fill" className="text-(--purple-11)" />
            <Text size="2" weight="medium" className="text-(--purple-12)">
              Ready to validate
            </Text>
          </Flex>
          <Text size="2" color="gray">
            All hoglets finished and the definition of done is set. Review and
            confirm the goal is met.
          </Text>
          <Button
            size="2"
            color="purple"
            onClick={onMarkValidated}
            className="self-start"
          >
            <CheckCircle size={14} />
            Mark validated
          </Button>
        </Flex>
      </div>
    );
  }

  if (lifecycle === "validated") {
    return (
      <div className="rounded-(--radius-2) border border-(--green-7) bg-(--green-2) p-3">
        <Flex direction="column" gap="2">
          <Flex align="center" gap="2">
            <CheckCircle
              size={16}
              weight="fill"
              className="text-(--green-11)"
            />
            <Text size="2" weight="medium" className="text-(--green-12)">
              Validated
            </Text>
          </Flex>
          <Text size="2" color="gray">
            Goal confirmed. Reopen the nest to hand the hedgehog more work, or
            compact it when you no longer need the full chat trail.
          </Text>
        </Flex>
      </div>
    );
  }

  return null;
}
