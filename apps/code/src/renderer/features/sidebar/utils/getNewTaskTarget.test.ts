import { describe, expect, it } from "vitest";
import { getNewTaskTarget } from "./getNewTaskTarget";

describe("getNewTaskTarget", () => {
  it("returns the folder id when the group has a matching local folder", () => {
    expect(
      getNewTaskTarget({
        groupFolderId: "folder-1",
        groupId: "posthog/code",
      }),
    ).toBe("folder-1");
  });

  it("returns initialCloudRepository for a cloud-only group with no local folder", () => {
    expect(
      getNewTaskTarget({
        groupFolderId: undefined,
        groupId: "posthog/code",
      }),
    ).toEqual({ initialCloudRepository: "posthog/code" });
  });

  it("returns undefined for the catch-all 'other' group with no folder id", () => {
    expect(
      getNewTaskTarget({
        groupFolderId: undefined,
        groupId: "other",
      }),
    ).toBeUndefined();
  });

  it("returns undefined when groupId is empty and no folder id is set", () => {
    expect(
      getNewTaskTarget({
        groupFolderId: undefined,
        groupId: "",
      }),
    ).toBeUndefined();
  });

  it("prefers the folder id even when groupId looks like a cloud repo", () => {
    expect(
      getNewTaskTarget({
        groupFolderId: "folder-7",
        groupId: "posthog/posthog",
      }),
    ).toBe("folder-7");
  });
});
