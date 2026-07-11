import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import type { SigningAccessService } from "@posthog/workspace-server/services/signing-access/contracts";
import { SIGNING_ACCESS_SERVICE } from "@posthog/workspace-server/services/signing-access/identifiers";
import {
  setSigningAccessEnabledInput,
  signingAccessStatusSchema,
} from "@posthog/workspace-server/services/signing-access/schemas";

export const signingAccessRouter = router({
  getStatus: publicProcedure
    .output(signingAccessStatusSchema)
    .query(({ ctx }) =>
      ctx.container
        .get<SigningAccessService>(SIGNING_ACCESS_SERVICE)
        .getStatus(),
    ),

  setEnabled: publicProcedure
    .input(setSigningAccessEnabledInput)
    .output(signingAccessStatusSchema)
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<SigningAccessService>(SIGNING_ACCESS_SERVICE)
        .setEnabled(input.enabled),
    ),
});
