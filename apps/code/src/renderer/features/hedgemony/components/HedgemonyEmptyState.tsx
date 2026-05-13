import { Flex, Text } from "@radix-ui/themes";
import explorerHog from "@renderer/assets/images/hedgehogs/explorer-hog.png";

export function HedgemonyEmptyState() {
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      height="100%"
      px="5"
      className="pointer-events-none"
    >
      <Flex direction="column" align="center" className="max-w-[420px]">
        <img
          src={explorerHog}
          alt=""
          className="mb-[12px] w-[120px] opacity-80"
        />
        <Text align="center" className="font-medium text-(--gray-10) text-sm">
          No nests yet
        </Text>
        <Text
          align="center"
          mt="1"
          className="text-(--gray-9) text-[13px] leading-[1.35]"
        >
          Click anywhere on the map to place a nest. Hoglets will gather around
          it to do the work.
        </Text>
      </Flex>
    </Flex>
  );
}
