import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import type { HogletService } from "../../services/hedgemony/hoglet-service";
import type { NestChatService } from "../../services/hedgemony/nest-chat-service";
import type { NestService } from "../../services/hedgemony/nest-service";
import {
  createNestInput,
  HedgemonyEvent,
  hoglet,
  hogletWatchScope,
  listHogletsInput,
  listHogletsOutput,
  listNestChatInput,
  listNestChatOutput,
  listNestsOutput,
  nest,
  nestIdInput,
  recordAdhocHogletInput,
  updateNestInput,
} from "../../services/hedgemony/schemas";
import { publicProcedure, router } from "../trpc";

const getService = () => container.get<NestService>(MAIN_TOKENS.NestService);
const getNestChatService = () =>
  container.get<NestChatService>(MAIN_TOKENS.NestChatService);
const getHogletService = () =>
  container.get<HogletService>(MAIN_TOKENS.HogletService);

export const hedgemonyRouter = router({
  nests: router({
    list: publicProcedure
      .output(listNestsOutput)
      .query(() => getService().list()),

    get: publicProcedure
      .input(nestIdInput)
      .output(nest)
      .query(({ input }) => getService().get(input)),

    create: publicProcedure
      .input(createNestInput)
      .output(nest)
      .mutation(({ input }) => getService().create(input)),

    update: publicProcedure
      .input(updateNestInput)
      .output(nest)
      .mutation(({ input }) => getService().update(input)),

    archive: publicProcedure
      .input(nestIdInput)
      .output(nest)
      .mutation(({ input }) => getService().archive(input)),

    unarchive: publicProcedure
      .input(nestIdInput)
      .output(nest)
      .mutation(({ input }) => getService().unarchive(input)),

    /**
     * Per-nest watch. Emits on status change, archive, and (later) hoglet
     * roster changes / hedgehog tick completion.
     */
    watch: publicProcedure.input(nestIdInput).subscription(async function* ({
      input,
      signal,
    }) {
      const service = getService();
      const iterable = service.toIterable(HedgemonyEvent.NestChanged, {
        signal,
      });
      for await (const data of iterable) {
        if (data.nestId === input.id) {
          yield data.event;
        }
      }
    }),
  }),
  nestChat: router({
    list: publicProcedure
      .input(listNestChatInput)
      .output(listNestChatOutput)
      .query(({ input }) => getNestChatService().list(input)),
  }),
  hoglets: router({
    recordAdhoc: publicProcedure
      .input(recordAdhocHogletInput)
      .output(hoglet)
      .mutation(({ input }) => getHogletService().recordAdhoc(input)),

    list: publicProcedure
      .input(listHogletsInput)
      .output(listHogletsOutput)
      .query(({ input }) => getHogletService().list(input)),

    /**
     * Per-scope watch. Operators of the floating holding panel subscribe with
     * `kind: "wild"`. Future slices will subscribe per nest for adopted hoglets.
     */
    watch: publicProcedure
      .input(hogletWatchScope)
      .subscription(async function* ({ input, signal }) {
        const service = getHogletService();
        const iterable = service.toIterable(HedgemonyEvent.HogletChanged, {
          signal,
        });
        for await (const data of iterable) {
          if (input.kind === "wild" && data.nestId === null) {
            yield data.event;
          } else if (input.kind === "nest" && data.nestId === input.nestId) {
            yield data.event;
          }
        }
      }),
  }),
});
