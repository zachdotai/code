import type { Hoglet, Nest } from "@main/services/rts/schemas";
import { describe, expect, it } from "vitest";
import type { TaskStatus } from "../components/hogletStatus";
import { deriveNestLifecycle, type NestLifecycle } from "./nestLifecycle";

type NestStub = Pick<Nest, "status" | "definitionOfDone">;
type HogletStub = Pick<Hoglet, "id" | "taskId">;

const nest = (
  status: Nest["status"],
  definitionOfDone: string | null = "Goal is met.",
): NestStub => ({ status, definitionOfDone });

const hoglet = (id: string, taskId = id): HogletStub => ({ id, taskId });

const statusMap =
  (entries: Record<string, TaskStatus>) =>
  (taskId: string): TaskStatus =>
    entries[taskId] ?? "not_started";

function lifecycle(
  nestArg: NestStub,
  hoglets: HogletStub[],
  taskStatusFor: (taskId: string) => TaskStatus,
): NestLifecycle {
  return deriveNestLifecycle({ nest: nestArg, hoglets, taskStatusFor });
}

describe("deriveNestLifecycle", () => {
  it("returns archived for archived nests regardless of hoglets", () => {
    expect(
      lifecycle(nest("archived"), [hoglet("a")], () => "in_progress"),
    ).toBe("archived");
  });

  it("returns dormant for dormant nests", () => {
    expect(lifecycle(nest("dormant"), [], () => "not_started")).toBe("dormant");
  });

  it("returns validated for validated nests", () => {
    expect(lifecycle(nest("validated"), [hoglet("a")], () => "completed")).toBe(
      "validated",
    );
  });

  it("returns planning for an active nest with no hoglets", () => {
    expect(lifecycle(nest("active"), [], () => "not_started")).toBe("planning");
  });

  it("returns working while any hoglet is non-terminal", () => {
    const tasks = statusMap({ a: "completed", b: "in_progress" });
    expect(lifecycle(nest("active"), [hoglet("a"), hoglet("b")], tasks)).toBe(
      "working",
    );
  });

  it("returns validating when all hoglets are terminal and DoD is set", () => {
    const tasks = statusMap({ a: "completed", b: "failed", c: "cancelled" });
    expect(
      lifecycle(nest("active"), [hoglet("a"), hoglet("b"), hoglet("c")], tasks),
    ).toBe("validating");
  });

  it("stays in working when DoD is not set, even if all hoglets are terminal", () => {
    const tasks = statusMap({ a: "completed" });
    expect(lifecycle(nest("active", null), [hoglet("a")], tasks)).toBe(
      "working",
    );
  });

  it("treats needs_attention like active for lifecycle purposes", () => {
    const tasks = statusMap({ a: "completed" });
    expect(lifecycle(nest("needs_attention"), [hoglet("a")], tasks)).toBe(
      "validating",
    );
  });
});
