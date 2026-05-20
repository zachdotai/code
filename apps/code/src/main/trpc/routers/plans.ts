import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  PlansWatcherEvent,
  type PlansWatcherEvents,
  planAppendInput,
  planReadInput,
  planReadOutput,
  planResolveInput,
} from "../../services/plans-watcher/schemas";
import type { PlansWatcherService } from "../../services/plans-watcher/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<PlansWatcherService>(MAIN_TOKENS.PlansWatcherService);

function subscribe<K extends keyof PlansWatcherEvents>(event: K) {
  return publicProcedure.subscription(async function* (opts) {
    const service = getService();
    await service.ensureStarted();
    const iterable = service.toIterable(event, { signal: opts.signal });
    for await (const data of iterable) {
      yield data;
    }
  });
}

export const plansRouter = router({
  read: publicProcedure
    .input(planReadInput)
    .output(planReadOutput)
    .query(async ({ input }) => {
      const service = getService();
      await service.ensureStarted();
      const content = await service.readPlan(input.filePath);
      return { content };
    }),

  appendThreadMessage: publicProcedure
    .input(planAppendInput)
    .mutation(({ input }) => getService().appendThreadMessage(input)),

  resolveThread: publicProcedure
    .input(planResolveInput)
    .mutation(({ input }) => getService().resolveThread(input)),

  ensureWatching: publicProcedure.mutation(() => getService().ensureStarted()),

  onChanged: subscribe(PlansWatcherEvent.PlanFileChanged),
  onDeleted: subscribe(PlansWatcherEvent.PlanFileDeleted),
});
