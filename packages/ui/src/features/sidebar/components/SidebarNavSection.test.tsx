import type { AppView } from "@posthog/ui/router/useAppView";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarNavSection } from "./SidebarNavSection";

const navigateToSkills = vi.fn();
const navigateToWebsiteSkills = vi.fn();
const useAppView = vi.fn<() => AppView>();

vi.mock("@posthog/ui/router/useAppView", () => ({
  useAppView: () => useAppView(),
}));
vi.mock("@posthog/ui/router/navigationBridge", () => ({
  navigateToActivity: vi.fn(),
  navigateToAgents: vi.fn(),
  navigateToCommandCenter: vi.fn(),
  navigateToHome: vi.fn(),
  navigateToInbox: vi.fn(),
  navigateToSkills: () => navigateToSkills(),
  navigateToUsage: vi.fn(),
  navigateToWebsiteCommandCenter: vi.fn(),
  navigateToWebsiteHome: vi.fn(),
  navigateToWebsiteSkills: () => navigateToWebsiteSkills(),
}));
vi.mock("@posthog/ui/router/useOpenTask", () => ({
  openTaskInput: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => false,
}));
vi.mock("@posthog/ui/features/feature-flags/useFeatureFlag", () => ({
  useFeatureFlag: () => false,
}));
vi.mock("@posthog/ui/features/usage/useSpendAnalysisEnabled", () => ({
  useSpendAnalysisEnabled: () => false,
}));
vi.mock("@posthog/ui/features/inbox/hooks/useInboxAllReports", () => ({
  useInboxAllReports: () => ({ counts: { pulls: 0 } }),
}));
vi.mock("@posthog/ui/features/tasks/useTasks", () => ({
  useTasks: () => ({ data: [] }),
}));
vi.mock("@posthog/ui/features/sidebar/sidebarStore", () => {
  const state = {
    channelsEnabled: false,
    setChannelsEnabled: vi.fn(),
    showAllUsers: false,
    showInternal: false,
  };
  return {
    useSidebarStore: (selector: (s: typeof state) => unknown) =>
      selector(state),
  };
});
vi.mock("@posthog/ui/features/command-center/commandCenterStore", () => {
  const state = { cells: [] };
  return {
    useCommandCenterStore: (selector: (s: typeof state) => unknown) =>
      selector(state),
  };
});
vi.mock("@posthog/ui/shell/commandMenuStore", () => {
  const state = { open: vi.fn() };
  return {
    useCommandMenuStore: (selector: (s: typeof state) => unknown) =>
      selector(state),
  };
});
vi.mock("@posthog/ui/shell/analytics", () => ({
  track: vi.fn(),
}));

function view(type: AppView["type"]): AppView {
  return { type };
}

function clickSkillsAndMcp() {
  fireEvent.click(screen.getByText("Skills and MCP"));
}

describe("SidebarNavSection Skills and MCP item", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("navigates to Skills when neither half is open", () => {
    useAppView.mockReturnValue(view("home"));
    render(<SidebarNavSection commandCenterActiveCount={0} />);
    clickSkillsAndMcp();
    expect(navigateToSkills).toHaveBeenCalledTimes(1);
  });

  // The combined item covers both routes; clicking it while the MCP half is
  // open must not yank the user back to Skills (dropping the MCP view state).
  it.each(["skills", "mcp-servers"] as const)(
    "does not navigate when the %s half is already open",
    (type) => {
      useAppView.mockReturnValue(view(type));
      render(<SidebarNavSection commandCenterActiveCount={0} />);
      clickSkillsAndMcp();
      expect(navigateToSkills).not.toHaveBeenCalled();
      expect(navigateToWebsiteSkills).not.toHaveBeenCalled();
    },
  );
});
