import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const mutateMock = vi.fn();

let subagentModelResult: {
  data: string | null | undefined;
  isLoading: boolean;
};
let previewConfigResult: { data: unknown };
let mutationResult: {
  mutate: typeof mutateMock;
  isPending: boolean;
  isError: boolean;
};
let glmEnabled: boolean;

vi.mock("@posthog/host-router/react", () => ({
  useHostTRPC: () => ({
    agent: {
      getSubagentModel: {
        queryOptions: () => ({ queryKey: ["subagentModel"] }),
      },
      getPreviewConfigOptions: {
        queryOptions: () => ({ queryKey: ["previewConfig"] }),
      },
      setSubagentModel: { mutationOptions: () => ({}) },
    },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: string[] }) =>
    options.queryKey?.[0] === "subagentModel"
      ? subagentModelResult
      : previewConfigResult,
  useMutation: () => mutationResult,
  useQueryClient: () => ({
    cancelQueries: vi.fn(),
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock("@posthog/ui/features/auth/store", () => ({
  useAuthStateValue: (selector: (state: { cloudRegion: string }) => unknown) =>
    selector({ cloudRegion: "us" }),
}));

vi.mock("@posthog/ui/features/feature-flags/useFeatureFlag", () => ({
  useFeatureFlag: () => glmEnabled,
}));

vi.mock("@posthog/ui/features/settings/settingsStore", () => ({
  useSettingsStore: () => ({
    allowBypassPermissions: false,
    setAllowBypassPermissions: vi.fn(),
  }),
}));

vi.mock("@posthog/ui/features/settings/sections/PermissionsSettings", () => ({
  PermissionsSettings: () => null,
}));

vi.mock("@posthog/ui/shell/analytics", () => ({
  track: vi.fn(),
}));

import { SubagentModelSetting } from "./ClaudeCodeSettings";

const CATALOG_OPTIONS = [
  {
    id: "model",
    name: "Model",
    type: "select",
    category: "model",
    currentValue: "claude-opus-4-8",
    options: [
      { value: "claude-opus-4-8", name: "Claude Opus 4.8" },
      { value: "claude-sonnet-5", name: "Claude Sonnet 5" },
      { value: "glm-5", name: "GLM 5" },
    ],
  },
];

function renderSetting() {
  return render(
    <Theme>
      <SubagentModelSetting />
    </Theme>,
  );
}

describe("SubagentModelSetting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    glmEnabled = false;
    subagentModelResult = { data: null, isLoading: false };
    previewConfigResult = { data: CATALOG_OPTIONS };
    mutationResult = { mutate: mutateMock, isPending: false, isError: false };
  });

  it("shows the sonnet default when nothing is stored", () => {
    renderSetting();

    expect(screen.getByRole("combobox")).toHaveTextContent("Sonnet (default)");
  });

  it("shows the inherit choice when stored", () => {
    subagentModelResult = { data: "inherit", isLoading: false };

    renderSetting();

    expect(screen.getByRole("combobox")).toHaveTextContent(
      "Inherit main model",
    );
  });

  it("shows a catalog model by display name when stored", () => {
    subagentModelResult = { data: "claude-sonnet-5", isLoading: false };

    renderSetting();

    expect(screen.getByRole("combobox")).toHaveTextContent("Claude Sonnet 5");
  });

  it("falls back to the raw stored value when it is not in the catalog", () => {
    subagentModelResult = { data: "sonnet", isLoading: false };

    renderSetting();

    expect(screen.getByRole("combobox")).toHaveTextContent("sonnet");
  });

  it("disables the select while the stored value is loading", () => {
    subagentModelResult = { data: undefined, isLoading: true };

    renderSetting();

    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("disables the select while a mutation is in flight", () => {
    mutationResult = { mutate: mutateMock, isPending: true, isError: false };

    renderSetting();

    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("surfaces a save failure", () => {
    mutationResult = { mutate: mutateMock, isPending: false, isError: true };

    renderSetting();

    expect(
      screen.getByText("Failed to save subagent model"),
    ).toBeInTheDocument();
  });

  it("renders without a model catalog when the preview query has no data", () => {
    previewConfigResult = { data: undefined };

    renderSetting();

    expect(screen.getByRole("combobox")).toHaveTextContent("Sonnet (default)");
  });
});
