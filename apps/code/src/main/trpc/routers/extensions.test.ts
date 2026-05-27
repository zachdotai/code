import { beforeEach, describe, expect, it, vi } from "vitest";

const extensionServiceMock = vi.hoisted(() => ({
  list: vi.fn(),
  listCommands: vi.fn(),
  listPrompts: vi.fn(),
  listSidebar: vi.fn(),
  executeCommand: vi.fn(),
  installFromZip: vi.fn(),
  uninstall: vi.fn(),
  toIterable: vi.fn(),
}));

vi.mock("../../di/container", () => ({
  container: {
    get: () => extensionServiceMock,
  },
}));

import { extensionsRouter } from "./extensions";

describe("extensionsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes extension commands through the service", async () => {
    extensionServiceMock.executeCommand.mockResolvedValue({
      handled: true,
      message: "done",
      prompt: "generated prompt",
    });
    const caller = extensionsRouter.createCaller({});

    await expect(
      caller.executeCommand({
        name: "hello",
        args: "Max",
        taskId: "task-1",
        repoPath: "/repo",
      }),
    ).resolves.toEqual({
      handled: true,
      message: "done",
      prompt: "generated prompt",
    });

    expect(extensionServiceMock.executeCommand).toHaveBeenCalledWith({
      name: "hello",
      args: "Max",
      taskId: "task-1",
      repoPath: "/repo",
    });
  });
});
