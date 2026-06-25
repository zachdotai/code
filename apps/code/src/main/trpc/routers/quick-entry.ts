import { z } from "zod";
import { container } from "../../di/container";
import { QUICK_ENTRY_SERVICE } from "../../di/tokens";
import {
  QuickEntryServiceEvent,
  type QuickEntryServiceEvents,
} from "../../services/quick-entry/schemas";
import type { QuickEntryService } from "../../services/quick-entry/service";
import { publicProcedure, router } from "../trpc";

const getService = () => container.get<QuickEntryService>(QUICK_ENTRY_SERVICE);

function subscribeToQuickEntryEvent<K extends keyof QuickEntryServiceEvents>(
  event: K,
) {
  return publicProcedure.subscription(async function* (opts) {
    const service = getService();
    const iterable = service.toIterable(event, { signal: opts.signal });
    for await (const data of iterable) {
      yield data;
    }
  });
}

const createTaskRequestInput = z.object({
  content: z.string(),
  repoPath: z.string(),
  workspaceMode: z.enum(["local", "worktree"]),
  branch: z.string().nullable(),
  adapter: z.enum(["claude", "codex"]),
  model: z.string().nullable(),
  reasoningLevel: z.string().nullable(),
  executionMode: z.string().nullable(),
});

export const quickEntryRouter = router({
  toggle: publicProcedure.mutation(() => {
    getService().toggle();
  }),

  show: publicProcedure.mutation(() => {
    getService().show();
  }),

  hide: publicProcedure.mutation(() => {
    getService().hide();
  }),

  getEnabled: publicProcedure
    .output(z.boolean())
    .query(() => getService().getEnabled()),

  setEnabled: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) => {
      getService().setEnabled(input.enabled);
    }),

  requestCreateTask: publicProcedure
    .input(createTaskRequestInput)
    .mutation(({ input }) => {
      getService().requestCreateTask(input);
    }),

  getRecentRepos: publicProcedure
    .input(
      z.object({ limit: z.number().int().positive().optional() }).optional(),
    )
    .query(({ input }) => {
      return getService().getRecentRepos(input?.limit);
    }),

  onFocusInput: subscribeToQuickEntryEvent(QuickEntryServiceEvent.FocusInput),
  onHide: subscribeToQuickEntryEvent(QuickEntryServiceEvent.Hide),
  onCreateTaskRequested: subscribeToQuickEntryEvent(
    QuickEntryServiceEvent.CreateTaskRequested,
  ),
});
