import { Check, Copy, GithubLogo, Warning } from "@phosphor-icons/react";
import { useHostTRPC } from "@posthog/host-router/react";
import { SettingRow } from "@posthog/ui/features/settings/SettingRow";
import { useCopy } from "@posthog/ui/primitives/useCopy";
import { Button, Callout, Flex, Spinner, Switch, Text } from "@radix-ui/themes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function CommitSigningSettings() {
  const trpc = useHostTRPC();
  const queryClient = useQueryClient();
  const statusQuery = useQuery(trpc.signingAccess.getStatus.queryOptions());
  const setEnabledMutation = useMutation(
    trpc.signingAccess.setEnabled.mutationOptions({
      onSuccess: (status) => {
        queryClient.setQueryData(
          trpc.signingAccess.getStatus.queryKey(),
          status,
        );
      },
    }),
  );
  const openGitHubMutation = useMutation(
    trpc.os.openExternal.mutationOptions(),
  );
  const { copied, copy } = useCopy();
  const { copied: copiedSetup, copy: copySetup } = useCopy();
  const status = statusQuery.data;
  const publicKey = status?.publicKey;
  const error =
    status?.error ??
    (statusQuery.error instanceof Error ? statusQuery.error.message : null) ??
    (setEnabledMutation.error instanceof Error
      ? setEnabledMutation.error.message
      : null);
  const requiresSigningIdentity = error?.includes("APPLE_CODESIGN_IDENTITY");
  const setupCommand =
    'export APPLE_CODESIGN_IDENTITY="Apple Development: Your Name (TEAMID)"';

  return (
    <Flex direction="column">
      <SettingRow
        label="Managed Secure Enclave signing"
        description="Use a hardware-backed, non-exportable key for commits created by local Claude and Codex sessions."
      >
        {statusQuery.isLoading ? (
          <Spinner size="1" />
        ) : (
          <Switch
            checked={status?.enabled ?? false}
            disabled={
              status?.supported === false || setEnabledMutation.isPending
            }
            onCheckedChange={(enabled) =>
              setEnabledMutation.mutate({ enabled })
            }
            size="1"
          />
        )}
      </SettingRow>

      {error ? (
        <Callout.Root
          color="red"
          size="1"
          variant="soft"
          className="my-3 w-full"
        >
          <Callout.Icon>
            <Warning weight="fill" />
          </Callout.Icon>
          <Callout.Text className="w-full min-w-0">
            <Flex direction="column" gap="2" className="min-w-0">
              <Text className="font-medium">
                Secure Enclave signing is unavailable
              </Text>
              <Text className="break-words text-[13px] text-gray-11">
                {error}
              </Text>
              {requiresSigningIdentity ? (
                <Flex direction="column" gap="2" mt="1" className="min-w-0">
                  <Text
                    as="div"
                    size="1"
                    className="break-all rounded-md bg-(--red-a3) p-2 font-mono"
                  >
                    {setupCommand}
                  </Text>
                  <Flex gap="2" wrap="wrap">
                    <Button
                      size="1"
                      variant="soft"
                      onClick={() => copySetup(setupCommand)}
                    >
                      {copiedSetup ? <Check size={14} /> : <Copy size={14} />}
                      {copiedSetup ? "Copied" : "Copy setup command"}
                    </Button>
                    <Button
                      size="1"
                      variant="outline"
                      onClick={() => statusQuery.refetch()}
                    >
                      Try again
                    </Button>
                  </Flex>
                </Flex>
              ) : (
                <Button
                  size="1"
                  variant="soft"
                  onClick={() => statusQuery.refetch()}
                  className="self-start"
                >
                  Try again
                </Button>
              )}
            </Flex>
          </Callout.Text>
        </Callout.Root>
      ) : null}

      <SettingRow
        label="Public key"
        description="Add this same key to GitHub twice: once as an Authentication Key and once as a Signing Key."
      >
        <Flex direction="column" gap="2" align="end" className="max-w-[420px]">
          {publicKey ? (
            <>
              <Text
                as="div"
                size="1"
                className="max-w-[420px] break-all rounded-md bg-(--gray-3) p-2 font-mono"
              >
                {publicKey}
              </Text>
              <Flex gap="2">
                <Button size="1" variant="soft" onClick={() => copy(publicKey)}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy public key"}
                </Button>
                <Button
                  size="1"
                  variant="outline"
                  onClick={() =>
                    openGitHubMutation.mutate({
                      url: "https://github.com/settings/keys",
                    })
                  }
                >
                  <GithubLogo size={14} />
                  Open GitHub keys
                </Button>
              </Flex>
            </>
          ) : (
            <Text color="gray" size="1">
              Unavailable
            </Text>
          )}
        </Flex>
      </SettingRow>

      <SettingRow
        label="GitHub key types"
        description="GitHub uses separate registrations for SSH authentication and verified commit signing."
        noBorder
      >
        <Flex direction="column" gap="1" align="end">
          <Text size="1">1. New SSH key → Authentication Key</Text>
          <Text size="1">2. New SSH key → Signing Key</Text>
        </Flex>
      </SettingRow>
    </Flex>
  );
}
