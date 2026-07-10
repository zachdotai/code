import { describe, expect, it } from "vitest";
import { hrefForTab, type TabHrefInput } from "./tabHref";

function identity(overrides: Partial<TabHrefInput>): TabHrefInput {
  return {
    dashboardId: null,
    taskId: null,
    channelId: null,
    channelSection: null,
    appView: null,
    ...overrides,
  };
}

// Mirrors goToTab's switch in BrowserTabStrip.tsx (typed navigate) — these two
// mappings must not drift; each case here matches a goToTab branch.
describe("hrefForTab", () => {
  it.each<[string, Partial<TabHrefInput>, string]>([
    ["channel task", { taskId: "t1", channelId: "c1" }, "/website/c1/tasks/t1"],
    ["channel-less task", { taskId: "t1" }, "/code/tasks/t1"],
    [
      "channel canvas",
      { dashboardId: "d1", channelId: "c1" },
      "/website/c1/dashboards/d1",
    ],
    ["channel home", { channelId: "c1" }, "/website/c1"],
    [
      "channel section",
      { channelId: "c1", channelSection: "artifacts" },
      "/website/c1/artifacts",
    ],
    [
      "stale channel section falls back to home",
      { channelId: "c1", channelSection: "not-a-section" },
      "/website/c1",
    ],
    ["home app view", { appView: "home" }, "/code/home"],
    ["inbox app view", { appView: "inbox" }, "/code/inbox"],
    ["agents app view", { appView: "agents" }, "/code/agents"],
    ["skills app view", { appView: "skills" }, "/skills"],
    ["mcp-servers app view", { appView: "mcp-servers" }, "/mcp-servers"],
    [
      "command-center app view",
      { appView: "command-center" },
      "/command-center",
    ],
    ["blank tab", {}, "/code"],
    ["unknown app view", { appView: "from-the-future" }, "/code"],
  ])("%s", (_name, overrides, expected) => {
    expect(hrefForTab(identity(overrides))).toBe(expected);
  });
});
