import {
  Brain,
  ClockClockwise,
  FolderSimple,
  House,
  type IconProps,
  Notebook,
  PlugsConnected,
} from "@phosphor-icons/react";
import { ScrollArea } from "@posthog/quill";
import { Box, Flex } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import type { ComponentType } from "react";
import { NewTaskItem } from "../../sidebar/components/items/HomeItem";
import { SidebarItem } from "../../sidebar/components/SidebarItem";

interface WorkSidebarItemSpec {
  icon: ComponentType<IconProps>;
  label: string;
  active?: boolean;
}

const ITEMS: WorkSidebarItemSpec[] = [
  { icon: House, label: "Home", active: true },
  { icon: FolderSimple, label: "Projects" },
  { icon: ClockClockwise, label: "Automations" },
  { icon: Notebook, label: "Artifacts" },
  { icon: PlugsConnected, label: "MCP" },
  { icon: Brain, label: "Memory" },
];

export function WorkSidebarMenu() {
  const setMode = useNavigationStore((s) => s.setMode);
  const navigateToTaskInput = useNavigationStore((s) => s.navigateToTaskInput);

  const handleNewTaskClick = () => {
    setMode("code");
    navigateToTaskInput();
  };

  return (
    <Box height="100%" position="relative">
      <ScrollArea className="h-full overflow-y-auto overflow-x-hidden">
        <Flex direction="column" py="2" px="2" gap="1px">
          <Box mb="2">
            <NewTaskItem
              isActive={false}
              onClick={handleNewTaskClick}
              variant="primary"
            />
          </Box>

          {ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Box key={item.label}>
                <SidebarItem
                  depth={0}
                  icon={
                    <Icon size={16} weight={item.active ? "fill" : "regular"} />
                  }
                  label={item.label}
                  isActive={item.active}
                />
              </Box>
            );
          })}
        </Flex>
      </ScrollArea>
    </Box>
  );
}
