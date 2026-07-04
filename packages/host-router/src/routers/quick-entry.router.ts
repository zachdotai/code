import { QUICK_ENTRY_SERVICE } from "@posthog/core/quick-entry/identifiers";
import type { IQuickEntryService } from "@posthog/core/quick-entry/quickEntry";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import { z } from "zod";

const shortcutState = z.object({
  accelerator: z.string(),
  registered: z.boolean(),
});

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

  getShortcut: publicProcedure
    .output(shortcutState)
    .query(({ ctx }) =>
      ctx.container.get<IQuickEntryService>(QUICK_ENTRY_SERVICE).getShortcut(),
    ),

  setShortcut: publicProcedure
    .input(z.object({ accelerator: z.string().min(1) }))
    .output(shortcutState)
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<IQuickEntryService>(QUICK_ENTRY_SERVICE)
        .setShortcut(input.accelerator),
    ),
});
