import { SettingRow } from "@features/settings/components/SettingRow";
import {
  CheckCircle,
  Package,
  PuzzlePiece,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { Badge, Box, Button, Flex, Spinner, Text } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import type { ExtensionInfo } from "@shared/types/extensions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showMessageBox } from "@utils/dialog";
import { toast } from "@utils/toast";
import { useCallback } from "react";

function formatContributionList(label: string, names: string[]): string | null {
  if (names.length === 0) return null;
  return `${label}: ${names.join(", ")}`;
}

function getExtensionDetails(extension: ExtensionInfo): string {
  return [
    formatContributionList(
      "Views",
      extension.sidebar.map((item) => item.title),
    ),
    formatContributionList(
      "Commands",
      extension.commands.map((command) => `/${command.name}`),
    ),
    formatContributionList(
      "Prompts",
      extension.prompts.map((prompt) => `/${prompt.name}`),
    ),
    extension.skillCount > 0 ? `Skills: ${extension.skillCount}` : null,
    formatContributionList("Load errors", extension.loadErrors),
  ]
    .filter((item): item is string => item !== null)
    .join(" · ");
}

export function ExtensionsSettings() {
  const trpcReact = useTRPC();
  const queryClient = useQueryClient();
  const { data: extensions = [], isLoading } = useQuery(
    trpcReact.extensions.list.queryOptions(undefined, { staleTime: 10_000 }),
  );
  const installMutation = useMutation(
    trpcReact.extensions.installZip.mutationOptions(),
  );
  const uninstallMutation = useMutation(
    trpcReact.extensions.uninstall.mutationOptions(),
  );

  const refreshExtensions = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries(trpcReact.extensions.list.pathFilter()),
      queryClient.invalidateQueries(
        trpcReact.extensions.listCommands.pathFilter(),
      ),
      queryClient.invalidateQueries(
        trpcReact.extensions.listPrompts.pathFilter(),
      ),
      queryClient.invalidateQueries(trpcReact.skills.list.pathFilter()),
    ]);
  }, [queryClient, trpcReact]);

  const handleInstall = useCallback(async () => {
    const files = await queryClient.fetchQuery(
      trpcReact.os.selectFiles.queryOptions(),
    );
    const zipPath = files.find((file) => file.toLowerCase().endsWith(".zip"));
    if (!zipPath) {
      toast.info("Choose a .zip extension package to install");
      return;
    }

    const confirmation = await showMessageBox({
      type: "warning",
      title: "Install extension?",
      message: "Only install extensions from sources you trust.",
      detail:
        "Extensions can include JavaScript runtime commands that run on your machine with PostHog Code's local permissions.",
      buttons: ["Cancel", "Install extension"],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirmation.response !== 1) return;

    try {
      const extension = await installMutation.mutateAsync({ zipPath });
      await refreshExtensions();
      toast.success(`Installed ${extension.displayName}`);
    } catch (error) {
      toast.error("Failed to install extension", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [installMutation, queryClient, refreshExtensions, trpcReact]);

  const handleUninstall = useCallback(
    async (extensionId: string, displayName: string) => {
      try {
        await uninstallMutation.mutateAsync({ extensionId });
        await refreshExtensions();
        toast.success(`Uninstalled ${displayName}`);
      } catch (error) {
        toast.error("Failed to uninstall extension", {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [refreshExtensions, uninstallMutation],
  );

  return (
    <Flex direction="column">
      <SettingRow
        label="Install extension"
        description="Install a zipped extension package with a root-level package.json. Extensions can add sidebar views, commands, prompt templates, and skills."
      >
        <Button
          size="1"
          variant="soft"
          onClick={handleInstall}
          disabled={installMutation.isPending}
        >
          {installMutation.isPending ? <Spinner size="1" /> : null}
          Install .zip
        </Button>
      </SettingRow>

      <SettingRow label="Installed extensions" noBorder>
        <Flex direction="column" gap="2" className="min-w-[360px]">
          {isLoading ? (
            <Flex align="center" gap="2" className="text-gray-10 text-sm">
              <Spinner size="1" /> Loading extensions...
            </Flex>
          ) : extensions.length === 0 ? (
            <Text className="text-gray-10 text-sm">
              No extensions installed
            </Text>
          ) : (
            extensions.map((extension) => {
              const details = getExtensionDetails(extension);
              return (
                <Flex
                  key={extension.id}
                  align="center"
                  justify="between"
                  gap="3"
                  className="rounded-md border border-gray-6 bg-gray-2 px-3 py-2"
                >
                  <Flex align="center" gap="2" className="min-w-0">
                    <Box className="flex shrink-0 items-center justify-center rounded bg-gray-4 p-1.5 text-gray-11">
                      <PuzzlePiece size={14} weight="duotone" />
                    </Box>
                    <Flex direction="column" className="min-w-0">
                      <Flex align="center" gap="2">
                        <Text className="truncate font-medium text-[13px]">
                          {extension.displayName}
                        </Text>
                        <Badge size="1" variant="soft" color="gray">
                          v{extension.version}
                        </Badge>
                      </Flex>
                      <Flex align="center" gap="2" wrap="wrap">
                        {extension.sidebar.length > 0 && (
                          <Badge size="1" variant="soft" color="blue">
                            <PuzzlePiece size={10} /> {extension.sidebar.length}{" "}
                            view
                            {extension.sidebar.length === 1 ? "" : "s"}
                          </Badge>
                        )}
                        {extension.commands.length > 0 && (
                          <Badge size="1" variant="soft" color="purple">
                            <Package size={10} /> {extension.commands.length}{" "}
                            command
                            {extension.commands.length === 1 ? "" : "s"}
                          </Badge>
                        )}
                        {extension.prompts.length > 0 && (
                          <Badge size="1" variant="soft" color="purple">
                            <Package size={10} /> {extension.prompts.length}{" "}
                            prompt
                            {extension.prompts.length === 1 ? "" : "s"}
                          </Badge>
                        )}
                        {extension.skillCount > 0 && (
                          <Badge size="1" variant="soft" color="green">
                            <CheckCircle size={10} /> {extension.skillCount}{" "}
                            skill
                            {extension.skillCount === 1 ? "" : "s"}
                          </Badge>
                        )}
                        {extension.loadErrors.length > 0 && (
                          <Badge size="1" variant="soft" color="red">
                            <WarningCircle size={10} />{" "}
                            {extension.loadErrors.length} load error
                            {extension.loadErrors.length === 1 ? "" : "s"}
                          </Badge>
                        )}
                      </Flex>
                      {details && (
                        <Text className="truncate text-[11px] text-gray-10">
                          {details}
                        </Text>
                      )}
                    </Flex>
                  </Flex>
                  <Button
                    size="1"
                    variant="ghost"
                    color="red"
                    onClick={() =>
                      handleUninstall(extension.id, extension.displayName)
                    }
                    disabled={uninstallMutation.isPending}
                  >
                    <Trash size={14} />
                  </Button>
                </Flex>
              );
            })
          )}
        </Flex>
      </SettingRow>
    </Flex>
  );
}
