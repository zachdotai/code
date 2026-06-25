import { QUICK_ENTRY_SERVICE } from "@posthog/core/quick-entry/identifiers";
import type { IQuickEntryService } from "@posthog/core/quick-entry/quickEntry";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import { z } from "zod";

export const quickEntryRouter = router({
  getEnabled: publicProcedure
    .output(z.boolean())
    .query(({ ctx }) =>
      ctx.container.get<IQuickEntryService>(QUICK_ENTRY_SERVICE).getEnabled(),
    ),

  setEnabled: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ ctx, input }) => {
      ctx.container
        .get<IQuickEntryService>(QUICK_ENTRY_SERVICE)
        .setEnabled(input.enabled);
    }),
});
