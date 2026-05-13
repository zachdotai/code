import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  scanRepoInput,
  scanRepoResultSchema,
} from "../../services/feature-scan/schemas";
import type { FeatureScanService } from "../../services/feature-scan/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<FeatureScanService>(MAIN_TOKENS.FeatureScanService);

export const featureScanRouter = router({
  scanRepo: publicProcedure
    .input(scanRepoInput)
    .output(scanRepoResultSchema)
    .mutation(({ input }) => getService().scanRepo(input.repoPath)),
});
