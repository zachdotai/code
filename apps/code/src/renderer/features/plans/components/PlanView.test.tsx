import { Theme } from "@radix-ui/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ensureWatchingMutate, planThreadsEnabledMock } = vi.hoisted(() => ({
  ensureWatchingMutate: vi.fn().mockResolvedValue(undefined),
  planThreadsEnabledMock: vi.fn().mockReturnValue(false),
}));

vi.mock("@renderer/trpc", () => ({
  trpc: {
    plans: {
      read: {
        queryOptions: (input: { filePath: string }) => ({
          queryKey: ["plans.read", input],
          queryFn: () => Promise.resolve({ content: "# Hello" }),
          staleTime: 0,
        }),
        queryFilter: (input: { filePath: string }) => ({
          queryKey: ["plans.read", input],
        }),
        queryKey: (input: { filePath: string }) => ["plans.read", input],
      },
      onChanged: {
        subscriptionOptions: () => ({
          subscriptionKey: "plans.onChanged",
          subscribe: () => () => undefined,
        }),
      },
      onDeleted: {
        subscriptionOptions: () => ({
          subscriptionKey: "plans.onDeleted",
          subscribe: () => () => undefined,
        }),
      },
    },
  },
  trpcClient: {
    plans: {
      ensureWatching: { mutate: ensureWatchingMutate },
    },
  },
}));

vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {
    plans: {
      ensureWatching: { mutate: ensureWatchingMutate },
    },
  },
}));

vi.mock("@trpc/tanstack-react-query", () => ({
  useSubscription: () => undefined,
}));

const { pendingPermissionsMock, modeOptionMock } = vi.hoisted(() => ({
  pendingPermissionsMock: vi.fn<() => Map<string, unknown>>(() => new Map()),
  modeOptionMock: vi.fn<() => unknown>(() => undefined),
}));
vi.mock("@features/sessions/hooks/useSession", () => ({
  usePendingPermissionsForTask: () => pendingPermissionsMock(),
  useConfigOptionForTask: () => modeOptionMock(),
}));

const sessionServiceMock = vi.hoisted(() => ({
  respondToPermission: vi.fn().mockResolvedValue(undefined),
  setSessionConfigOption: vi.fn().mockResolvedValue(undefined),
  sendPrompt: vi.fn().mockResolvedValue({ stopReason: "queued" }),
}));
vi.mock("@features/sessions/service/service", () => ({
  getSessionService: () => sessionServiceMock,
}));

vi.mock("@features/settings/stores/settingsStore", () => ({
  useSettingsStore: (
    selector: (s: { planThreadsEnabled: boolean }) => unknown,
  ) => selector({ planThreadsEnabled: planThreadsEnabledMock() }),
}));

const setActiveTabMock = vi.hoisted(() => vi.fn());
vi.mock("@features/panels/store/panelLayoutStore", () => ({
  usePanelLayoutStore: {
    getState: () => ({
      taskLayouts: {
        "task-1": {
          panelTree: {
            type: "leaf",
            id: "main-panel",
            content: {
              tabs: [{ id: "logs", label: "Chat", data: { type: "logs" } }],
              activeTabId: "logs",
            },
          },
        },
      },
      setActiveTab: setActiveTabMock,
    }),
  },
}));
vi.mock("@features/code-review/stores/reviewNavigationStore", () => ({
  useReviewNavigationStore: {
    getState: () => ({
      getReviewMode: () => "split",
      setReviewMode: vi.fn(),
    }),
  },
}));

import { PlanView } from "./PlanView";

function renderPlanView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Theme>
        <PlanView taskId="task-1" filePath="/tmp/plans/x.md" />
      </Theme>
    </QueryClientProvider>,
  );
}

describe("PlanView gating", () => {
  beforeEach(() => {
    ensureWatchingMutate.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders a disabled placeholder and does NOT start the watcher when the setting is off", () => {
    planThreadsEnabledMock.mockReturnValue(false);

    renderPlanView();

    expect(screen.getByText(/plan view is disabled/i)).toBeInTheDocument();
    expect(ensureWatchingMutate).not.toHaveBeenCalled();
  });

  it("starts the watcher when the setting is on", () => {
    planThreadsEnabledMock.mockReturnValue(true);

    renderPlanView();

    expect(ensureWatchingMutate).toHaveBeenCalledTimes(1);
  });
});

describe("PlanView approval bar", () => {
  beforeEach(() => {
    pendingPermissionsMock.mockReset();
    pendingPermissionsMock.mockReturnValue(new Map());
    modeOptionMock.mockReset();
    modeOptionMock.mockReturnValue(undefined);
    sessionServiceMock.respondToPermission.mockClear();
    sessionServiceMock.setSessionConfigOption.mockClear();
    sessionServiceMock.sendPrompt.mockClear();
    setActiveTabMock.mockClear();
    planThreadsEnabledMock.mockReturnValue(true);
  });

  it("renders the bar from `mode: plan` configOption when NO permission is pending (so it survives the comment loop)", async () => {
    modeOptionMock.mockReturnValue({
      id: "mode",
      name: "Approval Preset",
      type: "select",
      currentValue: "plan",
      options: [
        { value: "default", name: "Default" },
        { value: "acceptEdits", name: "Accept Edits" },
        { value: "plan", name: "Plan Mode" },
      ],
      category: "mode",
    });

    renderPlanView();
    await screen.findByText("The agent is waiting for plan approval.");

    expect(screen.getByText("Approve plan")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
  });

  it("Approve in mode-driven flow sets mode, sends an implement prompt, and switches to chat tab", async () => {
    modeOptionMock.mockReturnValue({
      id: "mode",
      name: "Approval Preset",
      type: "select",
      currentValue: "plan",
      options: [
        { value: "default", name: "Default" },
        { value: "plan", name: "Plan Mode" },
      ],
      category: "mode",
    });

    renderPlanView();
    const approveBtn = await screen.findByText("Approve plan");
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(sessionServiceMock.setSessionConfigOption).toHaveBeenCalledWith(
        "task-1",
        "mode",
        "default",
      );
    });
    // A prompt telling the agent to start implementing must follow.
    await waitFor(() => {
      expect(sessionServiceMock.sendPrompt).toHaveBeenCalledTimes(1);
    });
    const [, implementPrompt] = sessionServiceMock.sendPrompt.mock.calls[0];
    expect(implementPrompt).toMatch(/implement/i);
    // And the view should switch to the chat tab.
    expect(setActiveTabMock).toHaveBeenCalledWith(
      "task-1",
      expect.any(String),
      "logs",
    );

    expect(sessionServiceMock.respondToPermission).not.toHaveBeenCalled();
  });

  it("Approve in permission flow resolves the permission AND switches to chat tab", async () => {
    pendingPermissionsMock.mockReturnValue(
      new Map([
        [
          "tc-1",
          {
            taskRunId: "task-1",
            receivedAt: 0,
            options: [
              {
                optionId: "default",
                name: "Yes, manually approve edits",
                kind: "allow_once",
              },
              {
                optionId: "reject_with_feedback",
                name: "No, give feedback",
                kind: "reject_once",
              },
            ],
            toolCall: {
              toolCallId: "tc-1",
              title: "Ready to code?",
              kind: "switch_mode",
              content: [],
              locations: [],
              rawInput: {},
            },
          },
        ],
      ]) as never,
    );

    renderPlanView();
    fireEvent.click(await screen.findByText("Approve plan"));

    await waitFor(() => {
      expect(sessionServiceMock.respondToPermission).toHaveBeenCalledWith(
        "task-1",
        "tc-1",
        "default",
      );
    });
    expect(setActiveTabMock).toHaveBeenCalledWith(
      "task-1",
      expect.any(String),
      "logs",
    );
  });

  it("Reject in mode-driven flow sends a rejection prompt (does not change mode)", async () => {
    modeOptionMock.mockReturnValue({
      id: "mode",
      name: "Approval Preset",
      type: "select",
      currentValue: "plan",
      options: [
        { value: "default", name: "Default" },
        { value: "plan", name: "Plan Mode" },
      ],
      category: "mode",
    });

    renderPlanView();
    fireEvent.click(await screen.findByText("Reject"));
    fireEvent.change(
      screen.getByPlaceholderText(/Tell the agent what to do differently/i),
      { target: { value: "Too narrow" } },
    );
    fireEvent.click(screen.getByText("Send rejection"));

    await waitFor(() => {
      expect(sessionServiceMock.sendPrompt).toHaveBeenCalledTimes(1);
    });
    expect(sessionServiceMock.setSessionConfigOption).not.toHaveBeenCalled();
    const [, prompt] = sessionServiceMock.sendPrompt.mock.calls[0];
    expect(prompt).toContain("rejecting");
    expect(prompt).toContain("Too narrow");
  });

  it("renders Approve, Reject, and the mode Select when a switch_mode permission is pending", async () => {
    pendingPermissionsMock.mockReturnValue(
      new Map([
        [
          "tc-1",
          {
            taskRunId: "task-1",
            receivedAt: 0,
            options: [
              {
                optionId: "bypassPermissions",
                name: "Yes, bypass all permissions",
                kind: "allow_always",
              },
              { optionId: "auto", name: 'Yes, "auto"', kind: "allow_always" },
              {
                optionId: "default",
                name: "Yes, manually approve edits",
                kind: "allow_once",
              },
              {
                optionId: "reject_with_feedback",
                name: "No, give feedback",
                kind: "reject_once",
              },
            ],
            toolCall: {
              toolCallId: "tc-1",
              title: "Ready to code?",
              kind: "switch_mode",
              content: [],
              locations: [],
              rawInput: {},
            },
          },
        ],
      ]) as never,
    );

    renderPlanView();
    // Wait for the query to resolve and the inner to render the bar.
    await screen.findByText("The agent is waiting for plan approval.");

    expect(screen.getByText("Approve plan")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
    expect(screen.getByText("Mode")).toBeInTheDocument();
    // Default should be `default` (manual approval), not bypassPermissions.
    expect(screen.getByText("Yes, manually approve edits")).toBeInTheDocument();
  });
});
