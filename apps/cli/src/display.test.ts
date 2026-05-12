import type { TaskRun } from "@posthog/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printLogEntry, printStatus, printTaskCreated } from "./display.ts";

function makeRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: "run-1",
    task: "task-1",
    team: 1,
    branch: null,
    stage: null,
    environment: "cloud",
    status: "in_progress",
    log_url: "",
    error_message: null,
    output: null,
    state: {},
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    completed_at: null,
    ...overrides,
  };
}

describe("display", () => {
  let stdout: string;
  let stderr: string;

  beforeEach(() => {
    stdout = "";
    stderr = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("printStatus", () => {
    it("includes status label", () => {
      printStatus(makeRun({ status: "in_progress" }));
      expect(stdout).toContain("Running");
    });

    it("includes stage when set", () => {
      printStatus(makeRun({ stage: "build" }));
      expect(stdout).toContain("Stage: build");
    });

    it("includes branch when set", () => {
      printStatus(makeRun({ branch: "fix/bug" }));
      expect(stdout).toContain("Branch: fix/bug");
    });

    it("includes error_message when set", () => {
      printStatus(
        makeRun({ status: "failed", error_message: "out of memory" }),
      );
      expect(stdout).toContain("Error: out of memory");
    });

    it("handles completed status", () => {
      printStatus(makeRun({ status: "completed" }));
      expect(stdout).toContain("Completed");
    });
  });

  describe("printTaskCreated", () => {
    it("prints task id and run id", () => {
      printTaskCreated("task-abc", "run-xyz");
      expect(stdout).toContain("task-abc");
      expect(stdout).toContain("run-xyz");
    });

    it("includes status and watch command hints", () => {
      printTaskCreated("task-abc", "run-xyz");
      expect(stdout).toContain("posthog-code status task-abc");
    });
  });

  describe("printLogEntry", () => {
    it("prints agent message text", () => {
      printLogEntry({
        type: "notification",
        notification: {
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "agent_message",
              content: { type: "text", text: "Hello from agent" },
            },
          },
        },
      });
      expect(stdout).toContain("Hello from agent");
    });

    it("suppresses agent_thought_chunk", () => {
      printLogEntry({
        type: "notification",
        notification: {
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: "thinking..." },
            },
          },
        },
      });
      expect(stdout).toBe("");
    });

    it("prints task_notification summary", () => {
      printLogEntry({
        type: "notification",
        notification: {
          method: "_posthog/task_notification",
          params: { summary: "Research complete" },
        },
      });
      expect(stdout).toContain("Research complete");
    });

    it("prints branch_created branch name", () => {
      printLogEntry({
        type: "notification",
        notification: {
          method: "_posthog/branch_created",
          params: { branch: "feat/new-feature" },
        },
      });
      expect(stdout).toContain("feat/new-feature");
    });

    it("prints error to stderr", () => {
      printLogEntry({
        type: "notification",
        notification: {
          method: "_posthog/error",
          params: { message: "Something went wrong" },
        },
      });
      expect(stderr).toContain("Something went wrong");
      expect(stdout).toBe("");
    });

    it("suppresses idle status updates", () => {
      printLogEntry({
        type: "notification",
        notification: {
          method: "_posthog/status",
          params: { status: "idle" },
        },
      });
      expect(stdout).toBe("");
    });

    it("prints non-idle status", () => {
      printLogEntry({
        type: "notification",
        notification: {
          method: "_posthog/status",
          params: { status: "thinking" },
        },
      });
      expect(stdout).toContain("thinking");
    });

    it("ignores entries with no method", () => {
      printLogEntry({ type: "notification", notification: {} });
      expect(stdout).toBe("");
      expect(stderr).toBe("");
    });

    it("handles double-prefixed _posthog methods", () => {
      printLogEntry({
        type: "notification",
        notification: {
          method: "__posthog/task_notification",
          params: { summary: "Done" },
        },
      });
      expect(stdout).toContain("Done");
    });
  });
});
