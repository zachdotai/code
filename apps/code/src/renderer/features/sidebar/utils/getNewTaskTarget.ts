import type { TaskInputNavigationOptions } from "@stores/navigationStore";

export function getNewTaskTarget(args: {
  groupFolderId?: string;
  groupId: string;
}): string | TaskInputNavigationOptions | undefined {
  if (args.groupFolderId) return args.groupFolderId;
  if (args.groupId && args.groupId !== "other") {
    return { initialCloudRepository: args.groupId };
  }
  return undefined;
}
