import { createSidebarStore } from "@stores/createSidebarStore";

export const useMcpAppsSidebarStore = createSidebarStore({
  name: "mcp-apps-sidebar-storage",
  defaultWidth: 260,
  defaultOpen: false,
});
