import { Flex, Heading, Text } from "@radix-ui/themes";
import { createFileRoute } from "@tanstack/react-router";

// Home space: empty for now. The app rail's Home button lands here.
export const Route = createFileRoute("/")({
  component: HomeRoute,
});

function HomeRoute() {
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      height="100%"
      gap="2"
    >
      <Heading size="6">Home</Heading>
      <Text className="text-gray-10">Nothing here yet.</Text>
    </Flex>
  );
}
