import type { ServiceResolver } from "@posthog/host-trpc/context";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import { BROWSER_TABS_SERVICE } from "@posthog/workspace-server/di/tokens";
import {
  browserTabsSnapshotOutput,
  closePaneInput,
  closeTabInput,
  closeTabsInput,
  mergeTabIntoTabInput,
  newBlankTabInput,
  openOrFocusTabInput,
  setActiveTabInput,
  setFocusedPaneInput,
  setPaneSizesInput,
  setPaneTargetInput,
  setTabOrderInput,
} from "@posthog/workspace-server/services/browser-tabs/schemas";
import type { IBrowserTabsService } from "@posthog/workspace-server/services/browser-tabs/service";
import { z } from "zod";

const svc = (container: ServiceResolver) =>
  container.get<IBrowserTabsService>(BROWSER_TABS_SERVICE);

export const browserTabsRouter = router({
  getSnapshot: publicProcedure
    .output(browserTabsSnapshotOutput)
    .query(({ ctx }) => svc(ctx.container).getSnapshot()),

  getPrimaryWindowId: publicProcedure
    .output(z.string())
    .query(({ ctx }) => svc(ctx.container).getPrimaryWindowId()),

  openOrFocus: publicProcedure
    .input(openOrFocusTabInput)
    .output(browserTabsSnapshotOutput)
    .mutation(({ ctx, input }) => svc(ctx.container).openOrFocus(input)),

  newBlankTab: publicProcedure
    .input(newBlankTabInput)
    .output(browserTabsSnapshotOutput)
    .mutation(({ ctx, input }) => svc(ctx.container).newBlankTab(input)),

  setPaneTarget: publicProcedure
    .input(setPaneTargetInput)
    .output(browserTabsSnapshotOutput)
    .mutation(({ ctx, input }) => svc(ctx.container).setPaneTarget(input)),

  close: publicProcedure
    .input(closeTabInput)
    .output(browserTabsSnapshotOutput)
    .mutation(({ ctx, input }) => svc(ctx.container).close(input)),

  closeMany: publicProcedure
    .input(closeTabsInput)
    .output(browserTabsSnapshotOutput)
    .mutation(({ ctx, input }) =>
      svc(ctx.container).closeMany(input.tabIds, input.focusTabId),
    ),

  closePane: publicProcedure
    .input(closePaneInput)
    .output(browserTabsSnapshotOutput)
    .mutation(({ ctx, input }) => svc(ctx.container).closePane(input)),

  mergeTabIntoTab: publicProcedure
    .input(mergeTabIntoTabInput)
    .output(browserTabsSnapshotOutput)
    .mutation(({ ctx, input }) => svc(ctx.container).mergeTabIntoTab(input)),

  setOrder: publicProcedure
    .input(setTabOrderInput)
    .output(browserTabsSnapshotOutput)
    .mutation(({ ctx, input }) => svc(ctx.container).setOrder(input)),

  setActiveTab: publicProcedure
    .input(setActiveTabInput)
    .output(browserTabsSnapshotOutput)
    .mutation(({ ctx, input }) => svc(ctx.container).setActiveTab(input)),

  setFocusedPane: publicProcedure
    .input(setFocusedPaneInput)
    .output(browserTabsSnapshotOutput)
    .mutation(({ ctx, input }) => svc(ctx.container).setFocusedPane(input)),

  setPaneSizes: publicProcedure
    .input(setPaneSizesInput)
    .output(browserTabsSnapshotOutput)
    .mutation(({ ctx, input }) => svc(ctx.container).setPaneSizes(input)),

  onSnapshotChange: publicProcedure.subscription(async function* (opts) {
    for await (const snapshot of svc(opts.ctx.container).snapshotChangeEvents(
      opts.signal,
    )) {
      yield snapshot;
    }
  }),
});
