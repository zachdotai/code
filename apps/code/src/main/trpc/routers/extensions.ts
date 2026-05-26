import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  executeExtensionCommandInput,
  executeExtensionCommandOutput,
  extensionInfoSchema,
  installExtensionInput,
  listExtensionCommandsOutput,
  listExtensionPromptsOutput,
  listExtensionSidebarOutput,
  listExtensionsOutput,
  uninstallExtensionInput,
} from "../../services/extensions/schemas";
import type { ExtensionService } from "../../services/extensions/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<ExtensionService>(MAIN_TOKENS.ExtensionService);

export const extensionsRouter = router({
  list: publicProcedure
    .output(listExtensionsOutput)
    .query(() => getService().list()),

  listCommands: publicProcedure
    .output(listExtensionCommandsOutput)
    .query(() => getService().listCommands()),

  listPrompts: publicProcedure
    .output(listExtensionPromptsOutput)
    .query(() => getService().listPrompts()),

  listSidebar: publicProcedure
    .output(listExtensionSidebarOutput)
    .query(() => getService().listSidebar()),

  executeCommand: publicProcedure
    .input(executeExtensionCommandInput)
    .output(executeExtensionCommandOutput)
    .mutation(({ input }) => getService().executeCommand(input)),

  installZip: publicProcedure
    .input(installExtensionInput)
    .output(extensionInfoSchema)
    .mutation(({ input }) => getService().installFromZip(input.zipPath)),

  uninstall: publicProcedure
    .input(uninstallExtensionInput)
    .mutation(({ input }) => getService().uninstall(input.extensionId)),

  onChanged: publicProcedure.subscription(async function* (opts) {
    const service = getService();
    for await (const event of service.toIterable("changed", {
      signal: opts.signal,
    })) {
      yield event;
    }
  }),
});
