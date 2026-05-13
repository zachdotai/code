import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  addFolderInput,
  addFolderOutput,
  getFoldersOutput,
  getRepositoryByRemoteUrlInput,
  removeFolderInput,
  repositoryLookupResult,
  updateFolderAccessedInput,
} from "../../services/folders/schemas";
import {
  type FoldersService,
  FoldersServiceEvent,
} from "../../services/folders/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<FoldersService>(MAIN_TOKENS.FoldersService);

export const foldersRouter = router({
  getFolders: publicProcedure.output(getFoldersOutput).query(() => {
    return getService().getFolders();
  }),

  addFolder: publicProcedure
    .input(addFolderInput)
    .output(addFolderOutput)
    .mutation(({ input }) => {
      return getService().addFolder(input.folderPath, {
        remoteUrl: input.remoteUrl,
      });
    }),

  removeFolder: publicProcedure
    .input(removeFolderInput)
    .mutation(({ input }) => {
      return getService().removeFolder(input.folderId);
    }),

  updateFolderAccessed: publicProcedure
    .input(updateFolderAccessedInput)
    .mutation(({ input }) => {
      return getService().updateFolderAccessed(input.folderId);
    }),

  clearAllData: publicProcedure.mutation(() => {
    return getService().clearAllData();
  }),

  getRepositoryByRemoteUrl: publicProcedure
    .input(getRepositoryByRemoteUrlInput)
    .output(repositoryLookupResult)
    .query(({ input }) => {
      return getService().getRepositoryByRemoteUrl(input.remoteUrl);
    }),

  getMostRecentlyAccessedRepository: publicProcedure
    .output(repositoryLookupResult)
    .query(() => {
      return getService().getMostRecentlyAccessedRepository();
    }),

  triggerFeatureScan: publicProcedure
    .input(updateFolderAccessedInput)
    .mutation(({ input }) => {
      return getService().triggerFeatureScan(input.folderId);
    }),

  onNewRepository: publicProcedure.subscription(async function* (opts) {
    const service = getService();
    const iterable = service.toIterable(FoldersServiceEvent.NewRepository, {
      signal: opts.signal,
    });
    for await (const data of iterable) {
      yield data;
    }
  }),
});
