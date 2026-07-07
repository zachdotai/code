import { Skeleton } from "@radix-ui/themes";

/**
 * Per-route-kind pending skeletons, rendered as `pendingComponent` while a
 * route's loader awaits `yieldToPaint()`. They paint in the frame after a tab
 * click — before the destination's heavy mount — so they must stay trivially
 * cheap: static shapes only, no data, no hooks, no measurement.
 *
 * Each route kind gets its own silhouette so the loading state already reads
 * as the destination (chat thread vs. canvas grid vs. list), not a generic
 * spinner swap.
 */

/** Task detail: chat thread (alternating agent/user bubbles) + composer bar. */
export function TaskDetailSkeleton() {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-hidden px-4 pt-6">
        <div className="flex justify-end">
          <Skeleton width="55%" height="56px" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton width="40%" height="14px" />
          <Skeleton width="85%" height="14px" />
          <Skeleton width="70%" height="14px" />
        </div>
        <div className="flex justify-end">
          <Skeleton width="35%" height="40px" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton width="60%" height="14px" />
          <Skeleton width="90%" height="14px" />
          <Skeleton width="45%" height="14px" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <Skeleton width="100%" height="88px" />
      </div>
    </div>
  );
}

/** Canvas/dashboard: toolbar row + card grid. */
export function CanvasSkeleton() {
  return (
    <div className="flex h-full w-full flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Skeleton width="180px" height="24px" />
        <div className="flex-1" />
        <Skeleton width="80px" height="28px" />
        <Skeleton width="80px" height="28px" />
      </div>
      <div className="grid flex-1 grid-cols-3 content-start gap-4">
        <Skeleton width="100%" height="160px" />
        <Skeleton width="100%" height="160px" />
        <Skeleton width="100%" height="160px" />
        <Skeleton width="100%" height="160px" />
        <Skeleton width="100%" height="160px" />
        <Skeleton width="100%" height="160px" />
      </div>
    </div>
  );
}

/** Channel pages (home / inbox / artifacts / history / context): header + rows. */
export function ChannelSkeleton() {
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 p-6">
      <Skeleton width="220px" height="28px" />
      <Skeleton width="55%" height="14px" />
      <div className="mt-2 flex flex-col gap-2">
        <Skeleton width="100%" height="56px" />
        <Skeleton width="100%" height="56px" />
        <Skeleton width="100%" height="56px" />
        <Skeleton width="100%" height="56px" />
        <Skeleton width="100%" height="56px" />
      </div>
    </div>
  );
}

/** Top-level app pages (home, inbox, agents, skills, MCP servers, command center). */
export function AppPageSkeleton() {
  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <Skeleton width="240px" height="28px" />
        <div className="flex-1" />
        <Skeleton width="96px" height="28px" />
      </div>
      <Skeleton width="45%" height="14px" />
      <div className="mt-2 flex flex-col gap-2">
        <Skeleton width="100%" height="48px" />
        <Skeleton width="100%" height="48px" />
        <Skeleton width="100%" height="48px" />
        <Skeleton width="100%" height="48px" />
        <Skeleton width="100%" height="48px" />
        <Skeleton width="100%" height="48px" />
      </div>
    </div>
  );
}
