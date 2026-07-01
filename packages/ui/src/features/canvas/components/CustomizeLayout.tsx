import { LightbulbIcon, PlugsIcon } from "@phosphor-icons/react";
import { SidebarItem } from "@posthog/ui/features/sidebar/components/SidebarItem";
import { Box, Flex, Text } from "@radix-ui/themes";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";

// The Customize page's own secondary left sidebar. Skills and MCP servers were
// previously standalone /website mirrors; grouping them here keeps the top-level
// channels nav lean while giving both surfaces a shared home. Each item renders
// the same shared view (SkillsView / McpServersView) in the outlet to its right.
function CustomizeNav() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isMcp = pathname.startsWith("/website/customize/mcp-servers");
  const isSkills = !isMcp;

  return (
    <Flex
      direction="column"
      className="w-52 shrink-0 border-border border-r bg-chrome"
    >
      <Box className="px-4 pt-4 pb-2">
        <Text className="font-semibold text-[12px] text-gray-10 uppercase tracking-wide">
          Customize
        </Text>
      </Box>
      <Flex direction="column" className="gap-px px-2">
        <SidebarItem
          depth={0}
          icon={
            <LightbulbIcon size={16} weight={isSkills ? "fill" : "regular"} />
          }
          label="Skills"
          isActive={isSkills}
          onClick={() => navigate({ to: "/website/customize/skills" })}
        />
        <SidebarItem
          depth={0}
          icon={<PlugsIcon size={16} weight={isMcp ? "fill" : "regular"} />}
          label="MCP servers"
          isActive={isMcp}
          onClick={() => navigate({ to: "/website/customize/mcp-servers" })}
        />
      </Flex>
    </Flex>
  );
}

/** Layout for `/website/customize/*`: secondary sidebar + the active sub-view. */
export function CustomizeLayout() {
  return (
    <Flex className="h-full min-h-0">
      <CustomizeNav />
      <Box flexGrow="1" className="min-w-0 overflow-hidden">
        <Outlet />
      </Box>
    </Flex>
  );
}
