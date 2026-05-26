import { useExtensionsStore } from "@features/extensions/stores/extensionsStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftStore } from "../stores/draftStore";
import { getCommandSuggestions } from "./getSuggestions";

vi.mock("@utils/electronStorage", () => ({
  electronStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
}));

vi.mock("@renderer/trpc/client", () => ({
  trpc: {},
}));

vi.mock("@utils/queryClient", () => ({
  queryClient: {},
}));

describe("getCommandSuggestions", () => {
  beforeEach(() => {
    useExtensionsStore.getState().actions.clear();
    useDraftStore.setState((state) => ({
      ...state,
      drafts: {},
      contexts: {},
      commands: {},
      focusRequested: {},
      pendingContent: {},
      _hasHydrated: true,
    }));
  });

  it("labels command sources and keeps first-priority duplicate names", () => {
    useExtensionsStore.getState().actions.setExtensions([
      {
        id: "demo-extension",
        name: "demo-extension",
        displayName: "Demo Extension",
        version: "1.0.0",
        installPath: "/extensions/demo-extension",
        commands: [
          {
            extensionId: "demo-extension",
            name: "review",
            description: "Run extension review",
          },
        ],
        prompts: [
          {
            extensionId: "demo-extension",
            name: "review",
            description: "Run prompt review",
          },
          {
            extensionId: "demo-extension",
            name: "plan",
            description: "Plan work",
          },
        ],
        sidebar: [],
        skillCount: 0,
        loadErrors: [],
      },
    ]);
    useDraftStore
      .getState()
      .actions.setCommands("session-1", [
        { name: "review", description: "Skill review" },
      ]);

    const suggestions = getCommandSuggestions("session-1", "");

    expect(suggestions.find((item) => item.label === "review")).toMatchObject({
      description: "Extension command · Run extension review",
    });
    expect(suggestions.find((item) => item.label === "plan")).toMatchObject({
      description: "Prompt template · Plan work",
    });
  });
});
