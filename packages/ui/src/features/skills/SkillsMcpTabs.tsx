import { Lightbulb, Plugs } from "@phosphor-icons/react";
import { Tabs, TabsList, TabsTrigger } from "@posthog/quill";
import {
  navigateToMcpServers,
  navigateToSkills,
  navigateToWebsiteMcpServers,
  navigateToWebsiteSkills,
} from "@posthog/ui/router/navigationBridge";
import { Box } from "@radix-ui/themes";
import { useRouterState } from "@tanstack/react-router";

// Skills and MCP servers share one "Skills and MCP" destination; this strip is
// the top-level switch between the two halves. Each half keeps its own route
// (/skills, /mcp-servers, and their /website mirrors) so deep links, browser
// tabs, and back/forward keep working — switching navigates rather than
// toggling local state.
export function SkillsMcpTabs({
  active,
}: {
  active: "skills" | "mcp-servers";
}) {
  // In the Channels space, stay on the /website mirrors so the channels
  // chrome is preserved — same convention as SidebarNavSection.
  const inChannels = useRouterState({
    select: (s) => s.location.pathname.startsWith("/website"),
  });

  const handleChange = (value: string) => {
    if (value === active) return;
    if (value === "skills") {
      (inChannels ? navigateToWebsiteSkills : navigateToSkills)();
    } else {
      (inChannels ? navigateToWebsiteMcpServers : navigateToMcpServers)();
    }
  };

  return (
    <Box px="4" className="shrink-0 border-b border-b-(--gray-5)">
      <Tabs value={active} onValueChange={handleChange}>
        <TabsList variant="line" className="h-auto gap-0.5">
          <TabsTrigger value="skills" className="gap-1.5 px-2.5 py-2">
            <Lightbulb size={14} />
            <span className="font-medium text-[13px]">Skills</span>
          </TabsTrigger>
          <TabsTrigger value="mcp-servers" className="gap-1.5 px-2.5 py-2">
            <Plugs size={14} />
            <span className="font-medium text-[13px]">MCP servers</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </Box>
  );
}
