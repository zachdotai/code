import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockShouldWarn = false;
const mockDismissWarning = vi.fn();

const mockGuard = vi.hoisted(() => ({
  useBranchMismatchGuard: vi.fn(
    (): {
      shouldWarn: boolean;
      linkedBranch: string | null;
      currentBranch: string | null;
      dismissWarning: () => void;
    } => ({
      shouldWarn: mockShouldWarn,
      linkedBranch: "feat/foo",
      currentBranch: "main",
      dismissWarning: mockDismissWarning,
    }),
  ),
}));
vi.mock("./useBranchMismatch", () => mockGuard);

vi.mock("../git-interaction/useGitQueries", () => ({
  useGitQueries: () => ({ hasChanges: false }),
}));

vi.mock("../git-interaction/gitCacheKeys", () => ({
  invalidateGitBranchQueries: vi.fn(),
}));

// Tag each trpc mutation with a key so the useMutation mock can hand back a
// distinct mutate spy per mutation.
vi.mock("@posthog/host-router/react", () => ({
  useHostTRPC: () => ({
    git: {
      checkoutBranch: {
        mutationOptions: (opts: Record<string, unknown>) => ({
          ...opts,
          mutationKey: ["checkout"],
        }),
      },
    },
    workspace: {
      linkBranch: {
        mutationOptions: (opts: Record<string, unknown>) => ({
          ...opts,
          mutationKey: ["link"],
        }),
      },
    },
  }),
}));

type CapturedMutation = {
  onSuccess?: () => void;
  onError?: (e: Error) => void;
};
const captured: Record<string, CapturedMutation> = {};
const mutateSpies: Record<string, ReturnType<typeof vi.fn>> = {};

vi.mock("@tanstack/react-query", () => ({
  useMutation: (opts: { mutationKey?: string[] } & CapturedMutation) => {
    const key = opts.mutationKey?.[0] ?? "unknown";
    captured[key] = opts;
    mutateSpies[key] ??= vi.fn();
    return { mutate: mutateSpies[key], isPending: false };
  },
}));

vi.mock("../../shell/logger", () => ({
  logger: { scope: () => ({ error: vi.fn() }) },
}));

const mockTrack = vi.fn();
vi.mock("../../shell/analytics", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

import { ANALYTICS_EVENTS } from "@posthog/shared";
import { useBranchMismatchBanner } from "./useBranchMismatchBanner";

function renderBanner(overrides?: { shouldWarn?: boolean }) {
  mockShouldWarn = overrides?.shouldWarn ?? true;
  mockGuard.useBranchMismatchGuard.mockReturnValue({
    shouldWarn: mockShouldWarn,
    linkedBranch: "feat/foo",
    currentBranch: "main",
    dismissWarning: mockDismissWarning,
  });

  return renderHook(() =>
    useBranchMismatchBanner({ taskId: "task-1", repoPath: "/repo" }),
  );
}

describe("useBranchMismatchBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(captured)) delete captured[key];
    mockShouldWarn = false;
  });

  it("returns null and tracks nothing when there is no mismatch", () => {
    const { result } = renderBanner({ shouldWarn: false });

    expect(result.current).toBeNull();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("returns banner state and tracks shown once per appearance", () => {
    const { result, rerender } = renderBanner();

    expect(result.current).toMatchObject({
      linkedBranch: "feat/foo",
      currentBranch: "main",
      actionError: null,
    });
    rerender();

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith(
      ANALYTICS_EVENTS.BRANCH_MISMATCH_WARNING_SHOWN,
      {
        task_id: "task-1",
        linked_branch: "feat/foo",
        current_branch: "main",
        has_uncommitted_changes: false,
      },
    );
  });

  it("onSwitch checks out the linked branch and tracks switch", () => {
    const { result } = renderBanner();

    mockTrack.mockClear();
    act(() => {
      result.current?.onSwitch();
    });

    expect(mutateSpies.checkout).toHaveBeenCalledWith({
      directoryPath: "/repo",
      branchName: "feat/foo",
    });
    expect(mockTrack).toHaveBeenCalledWith(
      ANALYTICS_EVENTS.BRANCH_MISMATCH_ACTION,
      {
        task_id: "task-1",
        action: "switch",
        linked_branch: "feat/foo",
        current_branch: "main",
      },
    );

    act(() => {
      captured.checkout.onSuccess?.();
    });
    expect(mockDismissWarning).toHaveBeenCalled();
  });

  it("onSwitch failure surfaces the error without dismissing", () => {
    const { result } = renderBanner();

    act(() => {
      result.current?.onSwitch();
    });
    act(() => {
      captured.checkout.onError?.(new Error("dirty worktree"));
    });

    expect(result.current?.actionError).toBe("dirty worktree");
    expect(mockDismissWarning).not.toHaveBeenCalled();
  });

  it("onUseCurrentBranch re-links the task and tracks relink", () => {
    const { result } = renderBanner();

    mockTrack.mockClear();
    act(() => {
      result.current?.onUseCurrentBranch();
    });

    expect(mutateSpies.link).toHaveBeenCalledWith({
      taskId: "task-1",
      branchName: "main",
    });
    expect(mockTrack).toHaveBeenCalledWith(
      ANALYTICS_EVENTS.BRANCH_MISMATCH_ACTION,
      {
        task_id: "task-1",
        action: "relink",
        linked_branch: "feat/foo",
        current_branch: "main",
      },
    );

    act(() => {
      captured.link.onSuccess?.();
    });
    expect(mockDismissWarning).toHaveBeenCalled();
  });

  it("onUseCurrentBranch failure surfaces the error without dismissing", () => {
    const { result } = renderBanner();

    act(() => {
      result.current?.onUseCurrentBranch();
    });
    act(() => {
      captured.link.onError?.(new Error("no such task"));
    });

    expect(result.current?.actionError).toBe("no such task");
    expect(mockDismissWarning).not.toHaveBeenCalled();
  });

  it("onDismiss dismisses for the session and tracks dismiss", () => {
    const { result } = renderBanner();

    mockTrack.mockClear();
    act(() => {
      result.current?.onDismiss();
    });

    expect(mockDismissWarning).toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith(
      ANALYTICS_EVENTS.BRANCH_MISMATCH_ACTION,
      {
        task_id: "task-1",
        action: "dismiss",
        linked_branch: "feat/foo",
        current_branch: "main",
      },
    );
  });
});
