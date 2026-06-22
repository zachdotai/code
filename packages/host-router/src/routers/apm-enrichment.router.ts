import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import type { ApmEnrichmentService } from "@posthog/workspace-server/services/apm-enrichment/apmEnrichment";
import { APM_ENRICHMENT_SERVICE } from "@posthog/workspace-server/services/apm-enrichment/identifiers";
import { z } from "zod";

const enrichFileInput = z.object({
  filePath: z.string(),
});

export const apmEnrichmentRouter = router({
  enrichFile: publicProcedure
    .input(enrichFileInput)
    .query(({ ctx, input }) =>
      ctx.container
        .get<ApmEnrichmentService>(APM_ENRICHMENT_SERVICE)
        .enrichFile(input),
    ),
});
