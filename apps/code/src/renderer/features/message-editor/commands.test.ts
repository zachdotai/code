import { beforeEach, describe, expect, it, vi } from "vitest";

const executeCommandMock = vi.hoisted(() => vi.fn());
const trackMock = vi.hoisted(() => vi.fn());
const toastInfoMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {
    extensions: {
      executeCommand: { mutate: executeCommandMock },
    },
    os: {
      selectDirectory: { query: vi.fn() },
    },
  },
}));

vi.mock("@utils/analytics", () => ({
  track: trackMock,
}));

vi.mock("@utils/toast", () => ({
  toast: {
    info: toastInfoMock,
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

vi.mock("@features/folder-picker/stores/addDirectoryDialogStore", () => ({
  useAddDirectoryDialogStore: {
    getState: () => ({ show: vi.fn() }),
  },
}));

import { useExtensionsStore } from "@features/extensions/stores/extensionsStore";
import { tryExecuteCodeCommand } from "./commands";

const context = {
  taskId: "task-1",
  repoPath: "/repo",
  session: { taskRunId: "run-1", logUrl: "https://log", events: [] },
  taskRun: null,
};

describe("tryExecuteCodeCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useExtensionsStore.getState().actions.clear();
  });

  it("executes registered extension commands through tRPC before built-ins", async () => {
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
            name: "hello",
            description: "Say hello",
            input: { hint: "name" },
          },
        ],
        prompts: [],
        sidebar: [],
        skillCount: 0,
        loadErrors: [],
      },
    ]);
    executeCommandMock.mockResolvedValue({
      handled: true,
      message: "Hello Max",
    });

    await expect(tryExecuteCodeCommand("/hello Max", context)).resolves.toEqual(
      { handled: true },
    );

    expect(executeCommandMock).toHaveBeenCalledWith({
      name: "hello",
      args: "Max",
      taskId: "task-1",
      repoPath: "/repo",
    });
    expect(toastInfoMock).toHaveBeenCalledWith("Hello Max");
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("returns generated prompts from extension commands", async () => {
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
            name: "ralph-done",
            description: "Advance Ralph loop",
          },
        ],
        prompts: [],
        sidebar: [],
        skillCount: 0,
        loadErrors: [],
      },
    ]);
    executeCommandMock.mockResolvedValue({
      handled: true,
      prompt: "next iteration prompt",
    });

    await expect(
      tryExecuteCodeCommand("/ralph-done", context),
    ).resolves.toEqual({ handled: true, prompt: "next iteration prompt" });
  });

  it("does not call extension command tRPC for unknown slash commands", async () => {
    await expect(tryExecuteCodeCommand("/unknown", context)).resolves.toEqual({
      handled: false,
    });

    expect(executeCommandMock).not.toHaveBeenCalled();
  });
});
