import { FullScreenLayout } from "@components/FullScreenLayout";
import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useLogoutMutation } from "@features/auth/hooks/authMutations";
import {
  authKeys,
  getAuthIdentity,
  useAuthStateValue,
} from "@features/auth/hooks/authQueries";
import { SettingsDialog } from "@features/settings/components/SettingsDialog";
import { useSettingsDialogStore } from "@features/settings/stores/settingsDialogStore";
import {
  ArrowSquareOut,
  CheckCircle,
  GearSix,
  Robot,
  SignOut,
  WarningCircle,
} from "@phosphor-icons/react";
import { Button, Callout, Flex, Spinner, Text } from "@radix-ui/themes";
import { SHORTCUTS } from "@renderer/constants/keyboard-shortcuts";
import { trpcClient } from "@renderer/trpc/client";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { logger } from "@utils/logger";
import { motion } from "framer-motion";
import { useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

const log = logger.scope("ai-approval-screen");

interface AiApprovalScreenProps {
  orgId: string | null;
  orgName: string | null;
  isAdmin: boolean;
}

export function AiApprovalScreen({
  orgId,
  orgName,
  isAdmin,
}: AiApprovalScreenProps) {
  const logoutMutation = useLogoutMutation();
  const openSettings = useSettingsDialogStore((s) => s.open);
  const cloudRegion = useAuthStateValue((s) => s.cloudRegion);
  const projectId = useAuthStateValue((s) => s.projectId);
  const status = useAuthStateValue((s) => s.status);
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();
  const [fellBackToWeb, setFellBackToWeb] = useState(false);

  useHotkeys(SHORTCUTS.SETTINGS, () => openSettings(), {
    preventDefault: true,
    enableOnFormTags: true,
  });

  const approvalUrl = cloudRegion
    ? `${getCloudUrlFromRegion(cloudRegion)}/settings/organization-details#organization-ai-consent`
    : null;

  const openApproval = () => {
    if (!approvalUrl) return;
    void trpcClient.os.openExternal.mutate({ url: approvalUrl });
  };

  // Compute the same auth identity used by `useCurrentUser` so we invalidate
  // the right cache key after toggling — onboarding then re-runs the
  // `needsAiApproval` check and lets us into the main app without a refresh.
  const authIdentity = getAuthIdentity({
    status,
    cloudRegion,
    projectId,
    bootstrapComplete: false,
    availableProjectIds: [],
    availableOrgIds: [],
    hasCodeAccess: null,
    needsScopeReauth: false,
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!client || !orgId) {
        throw new Error("Missing API client or organization");
      }
      await client.setAiDataProcessingApproved(orgId, true);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: authKeys.currentUser(authIdentity),
      });
    },
    onError: (err) => {
      log.warn("Inline AI approval failed; falling back to web", err);
      setFellBackToWeb(true);
    },
  });

  const footerLeft = (
    <Button
      size="1"
      variant="ghost"
      color="gray"
      onClick={() => openSettings()}
      className="opacity-70"
    >
      <GearSix size={14} />
      Settings
    </Button>
  );

  const footerRight = (
    <Button
      size="1"
      variant="ghost"
      color="gray"
      onClick={() => logoutMutation.mutate()}
      className="opacity-50"
    >
      <SignOut size={14} />
      Log out
    </Button>
  );

  return (
    <>
      <FullScreenLayout footerLeft={footerLeft} footerRight={footerRight}>
        <Flex align="center" justify="center" height="100%" px="8">
          <Flex
            direction="column"
            className="w-full max-w-[560px] pt-[24px] pb-[40px]"
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Flex direction="column" gap="5">
                <Flex direction="column" gap="2">
                  <Flex align="center" gap="2">
                    <Robot
                      size={22}
                      weight="duotone"
                      color="var(--accent-10)"
                    />
                    <Text className="font-bold text-(--gray-12) text-2xl">
                      PostHog AI needs your approval
                    </Text>
                  </Flex>
                  <Text className="text-(--gray-11) text-sm">
                    {orgName
                      ? `The "${orgName}" organization hasn't approved AI data processing yet.`
                      : "Your organization hasn't approved AI data processing yet."}{" "}
                    PostHog AI may process identifying user data with external
                    AI providers. Your data won't be used for training models.
                  </Text>
                </Flex>

                <Callout.Root color="amber" size="1" variant="soft">
                  <Callout.Icon>
                    <WarningCircle />
                  </Callout.Icon>
                  <Callout.Text>
                    This feature is not HIPAA-compliant and is not intended for
                    the processing of Protected Health Information ("PHI"). Any
                    Business Associate Agreement ("BAA") you may have entered
                    into with PostHog does not apply to this functionality.
                  </Callout.Text>
                </Callout.Root>

                {isAdmin ? (
                  <AdminApprovalActions
                    canApproveInline={!!client && !!orgId}
                    approvalUrl={approvalUrl}
                    isPending={approveMutation.isPending}
                    fellBackToWeb={fellBackToWeb}
                    error={
                      approveMutation.error instanceof Error
                        ? approveMutation.error.message
                        : null
                    }
                    onApprove={() => approveMutation.mutate()}
                    onOpenApproval={openApproval}
                  />
                ) : (
                  <Text className="text-(--gray-11) text-sm">
                    Ask an organization admin to approve AI data processing.
                  </Text>
                )}
              </Flex>
            </motion.div>
          </Flex>
        </Flex>
      </FullScreenLayout>
      <SettingsDialog />
    </>
  );
}

interface AdminApprovalActionsProps {
  canApproveInline: boolean;
  approvalUrl: string | null;
  isPending: boolean;
  fellBackToWeb: boolean;
  error: string | null;
  onApprove: () => void;
  onOpenApproval: () => void;
}

function AdminApprovalActions({
  canApproveInline,
  approvalUrl,
  isPending,
  fellBackToWeb,
  error,
  onApprove,
  onOpenApproval,
}: AdminApprovalActionsProps) {
  // If the inline call ever fails (e.g. an older backend without the narrow
  // exemption, a temporary 403, or a network error), fall through to the old
  // "open the web settings" path so the user is never stuck. Robust against
  // dismissal because the Skip button below logs out instead of looping.
  if (fellBackToWeb || !canApproveInline) {
    return (
      <Flex direction="column" gap="2">
        <Button
          size="3"
          onClick={onOpenApproval}
          disabled={!approvalUrl}
          className="w-full"
        >
          Approve in PostHog
          <ArrowSquareOut size={16} />
        </Button>
        <Text className="text-(--gray-10) text-[13px]">
          {error
            ? `${error}. Opens PostHog in your browser — come back once you've approved.`
            : "Opens PostHog in your browser. Come back here once you've approved."}
        </Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="2">
      <Button
        size="3"
        onClick={onApprove}
        disabled={isPending}
        className="w-full"
      >
        {isPending ? (
          <>
            <Spinner size="2" />
            Approving…
          </>
        ) : (
          <>
            <CheckCircle size={16} weight="bold" />
            Approve AI data processing
          </>
        )}
      </Button>
      <Text className="text-(--gray-10) text-[13px]">
        Toggles the org-level setting from here. You can change this later in
        organization settings on PostHog.
      </Text>
    </Flex>
  );
}
