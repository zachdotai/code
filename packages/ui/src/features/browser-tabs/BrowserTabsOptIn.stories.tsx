import { DragDropProvider } from "@dnd-kit/react";
import { BrainIcon, HouseIcon } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Flex } from "@radix-ui/themes";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TabStrip, type TabView } from "./TabStrip";

const tabs: TabView[] = [
  {
    id: "home",
    label: "Home",
    channelName: null,
    icon: <HouseIcon size={14} />,
    pinned: true,
  },
  {
    id: "task",
    label: "Gate browser tabs on Contexts",
    channelName: "code",
    icon: <BrainIcon size={14} />,
  },
];

function BrowserTabsOptIn({ contextsEnabled }: { contextsEnabled: boolean }) {
  return (
    <Flex
      direction="column"
      className="h-48 overflow-hidden rounded-lg border border-border bg-background"
    >
      <Flex align="center" className="drag h-10 shrink-0 bg-chrome px-3">
        <Flex align="center" className="w-52 shrink-0">
          <Button variant="outline" size="sm">
            PostHog Code
          </Button>
        </Flex>
        {contextsEnabled ? (
          <DragDropProvider>
            <TabStrip
              tabs={tabs}
              activeTabId="task"
              onSelect={() => {}}
              onClose={() => {}}
              onNewTab={() => {}}
              onTogglePin={() => {}}
              onCloseOthers={() => {}}
              onCloseToRight={() => {}}
              onCloseToLeft={() => {}}
            />
          </DragDropProvider>
        ) : null}
      </Flex>
      <Flex
        align="center"
        justify="center"
        className="flex-1 border-border border-t text-muted text-sm"
      >
        {contextsEnabled
          ? "Contexts enabled: browser tabs are available"
          : "Contexts disabled: the title bar has no browser tabs"}
      </Flex>
    </Flex>
  );
}

const meta: Meta<typeof BrowserTabsOptIn> = {
  title: "Features/Browser Tabs/Contexts Opt-In",
  component: BrowserTabsOptIn,
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof BrowserTabsOptIn>;

export const ContextsDisabled: Story = {
  args: { contextsEnabled: false },
};

export const ContextsEnabled: Story = {
  args: { contextsEnabled: true },
};
