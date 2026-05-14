import { z } from "zod";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  type MemoryService,
  MemoryServiceEvent,
} from "../../services/memory/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<MemoryService>(MAIN_TOKENS.MemoryService);

export const memoryRouter = router({
  list: publicProcedure.query(() => getService().list()),

  get: publicProcedure
    .input(z.object({ relativePath: z.string() }))
    .query(({ input }) => getService().get(input.relativePath)),

  write: publicProcedure
    .input(z.object({ relativePath: z.string(), content: z.string() }))
    .mutation(({ input }) =>
      getService().write(input.relativePath, input.content),
    ),

  create: publicProcedure
    .input(z.object({ name: z.string(), type: z.string() }))
    .mutation(({ input }) => getService().create(input.name, input.type)),

  delete: publicProcedure
    .input(z.object({ relativePath: z.string() }))
    .mutation(({ input }) => getService().delete(input.relativePath)),

  clearAll: publicProcedure.mutation(() => getService().clearAll()),

  getGraph: publicProcedure.query(() => getService().getGraph()),

  getRoot: publicProcedure.query(() => getService().getRoot()),

  setRoot: publicProcedure
    .input(z.object({ root: z.string() }))
    .mutation(({ input }) => {
      getService().setRoot(input.root);
    }),

  onChanged: publicProcedure.subscription(async function* (opts) {
    const service = getService();
    for await (const data of service.toIterable(MemoryServiceEvent.Changed, {
      signal: opts.signal,
    })) {
      yield data;
    }
  }),
});
