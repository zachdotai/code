import {
  ArrowClockwise,
  ArrowLeft,
  ArrowUpRight,
  Check,
  DownloadSimple,
  MagnifyingGlass,
  Prohibit,
  Shield,
  Trash,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import type {
  McpRecommendedServer,
  McpServerInstallation,
} from "@posthog/api-client/posthog-client";
import { resolveServerDetails } from "@posthog/core/mcp-servers/resolveServerName";
import { getInstallationStatus } from "@posthog/core/mcp-servers/status";
import {
  countActiveTools,
  countRemovedTools,
  countToolsByApproval,
  filterToolsByName,
  sortToolsForDisplay,
} from "@posthog/core/mcp-servers/toolDerivation";
import { useIsOrgAdmin } from "@posthog/ui/features/auth/useOrgRole";
import { ServerIcon } from "@posthog/ui/features/mcp-servers/components/parts/icons";
import {
  STATUS_COLORS,
  STATUS_LABELS,
} from "@posthog/ui/features/mcp-servers/components/parts/statusBadge";
import { ToolRow } from "@posthog/ui/features/mcp-servers/components/parts/ToolRow";
import { useMcpInstallationTools } from "@posthog/ui/features/mcp-servers/hooks/useMcpInstallationTools";
import {
  AlertDialog,
  Badge,
  Button,
  Flex,
  IconButton,
  Separator,
  Spinner,
  Switch,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import { useMemo, useState } from "react";

interface ServerDetailViewProps {
  installation: McpServerInstallation | null;
  template: McpRecommendedServer | null;
  isEnabled: boolean;
  isInstalling: boolean;
  isReauthorizing: boolean;
  isSharing: boolean;
  isUnsharing: boolean;
  /** Whether the current user already has their own personal installation for
   *  this server — hides "Connect personally" on a teammate's shared server. */
  hasPersonalInstall: boolean;
  onBack: () => void;
  onConnect: () => void;
  onReauthorize: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onUninstall: () => void;
  onShare: () => void;
  onUnshare: () => void;
}

export function ServerDetailView({
  installation,
  template,
  isEnabled,
  isInstalling,
  isReauthorizing,
  isSharing,
  isUnsharing,
  hasPersonalInstall,
  onBack,
  onConnect,
  onReauthorize,
  onToggleEnabled,
  onUninstall,
  onShare,
  onUnshare,
}: ServerDetailViewProps) {
  const [showRemoved, setShowRemoved] = useState(false);
  const [toolSearch, setToolSearch] = useState("");
  const [shareConfirmOpen, setShareConfirmOpen] = useState(false);

  // Shared-scope gating. `is_owner` is absent on older backends; treat unknown
  // as owner so controls stay usable — the backend is the enforcement point.
  const { isAdmin } = useIsOrgAdmin();
  const isShared = installation?.scope === "shared";
  const isOwner = !!installation && installation.is_owner !== false;
  const canShare = !!installation && !isShared && isOwner && isAdmin === true;
  const canUnshare =
    !!installation && isShared && (isOwner || isAdmin === true);
  const canRemove =
    !!installation && (!isShared || isOwner || isAdmin === true);
  const canManage = !!installation && (!isShared || isOwner);
  const canConnectPersonally =
    isShared && !isOwner && !!template && !hasPersonalInstall;

  const { name, description, docsUrl, iconKey, authType } =
    resolveServerDetails(installation, template);

  const {
    tools,
    isLoading,
    setToolApproval,
    setBulkApproval,
    bulkPending,
    refresh,
    refreshPending,
  } = useMcpInstallationTools(installation?.id ?? null, {
    includeRemoved: showRemoved,
    autoRefreshIfEmpty: true,
  });

  const status = installation ? getInstallationStatus(installation) : null;
  const statusLabel = status ? STATUS_LABELS[status] : "Not installed";
  const statusColor = status ? STATUS_COLORS[status] : "gray";

  const counts = useMemo(() => countToolsByApproval(tools), [tools]);

  const visibleTools = useMemo(() => sortToolsForDisplay(tools), [tools]);

  const filteredTools = useMemo(
    () => filterToolsByName(visibleTools, toolSearch),
    [visibleTools, toolSearch],
  );

  const removedCount = countRemovedTools(tools);

  return (
    <Flex direction="column" gap="4" className="min-w-0">
      <Flex align="center" gap="2">
        <Button variant="ghost" color="gray" size="1" onClick={onBack}>
          <ArrowLeft size={12} />
          Back
        </Button>
      </Flex>

      <Flex align="start" gap="3">
        <ServerIcon iconKey={iconKey} size={56} />
        <Flex direction="column" gap="1" className="min-w-0 flex-1">
          <Flex align="center" gap="2">
            <Text truncate className="font-bold text-xl">
              {name}
            </Text>
            {installation?.scope === "shared" && (
              <Tooltip content="Available to all project members and autonomous agents">
                <Badge color="blue" variant="soft">
                  Shared
                </Badge>
              </Tooltip>
            )}
            {installation && (
              <Badge color={statusColor} variant="soft">
                {statusLabel}
              </Badge>
            )}
          </Flex>
          {description && (
            <Text color="gray" className="text-sm">
              {description}
            </Text>
          )}
          <Flex gap="3" align="center" mt="1">
            {authType && (
              <Badge color="gray" variant="outline" size="1">
                {authType === "oauth" ? "OAuth" : "API key"}
              </Badge>
            )}
            {docsUrl && (
              <a
                href={docsUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1 text-accent-11 text-xs hover:underline"
              >
                <ArrowUpRight size={11} />
                Docs
              </a>
            )}
          </Flex>
        </Flex>
        <Flex direction="column" align="end" gap="2" className="shrink-0">
          <Flex gap="2" align="center">
            {installation ? (
              status === "needs_reauth" || status === "pending_oauth" ? (
                <Button
                  variant="solid"
                  size="2"
                  onClick={onReauthorize}
                  disabled={isReauthorizing}
                >
                  {isReauthorizing ? <Spinner size="1" /> : null}
                  Reconnect
                </Button>
              ) : null
            ) : (
              <Button
                variant="solid"
                size="2"
                onClick={onConnect}
                disabled={isInstalling}
              >
                {isInstalling ? (
                  <Spinner size="1" />
                ) : (
                  <DownloadSimple size={12} />
                )}
                Connect
              </Button>
            )}
            {canConnectPersonally && (
              <Tooltip content="Connect your own account instead of using the shared connection">
                <Button
                  variant="outline"
                  size="2"
                  onClick={onConnect}
                  disabled={isInstalling}
                >
                  {isInstalling ? (
                    <Spinner size="1" />
                  ) : (
                    <DownloadSimple size={12} />
                  )}
                  Connect personally
                </Button>
              </Tooltip>
            )}
            {canShare && (
              <Button
                variant="outline"
                size="2"
                onClick={() => setShareConfirmOpen(true)}
                disabled={isSharing}
              >
                {isSharing ? <Spinner size="1" /> : <UsersThree size={12} />}
                Share with project
              </Button>
            )}
            {canUnshare && (
              <Button
                variant="outline"
                color="gray"
                size="2"
                onClick={onUnshare}
                disabled={isUnsharing}
              >
                {isUnsharing ? <Spinner size="1" /> : null}
                Unshare
              </Button>
            )}
            {installation && canRemove && (
              <Tooltip content="Remove server">
                <IconButton
                  variant="ghost"
                  color="red"
                  size="2"
                  onClick={onUninstall}
                >
                  <Trash size={14} />
                </IconButton>
              </Tooltip>
            )}
          </Flex>
          {installation && status === "connected" && canManage && (
            <Flex align="center" gap="2">
              <Switch
                size="1"
                checked={isEnabled}
                onCheckedChange={onToggleEnabled}
              />
            </Flex>
          )}
        </Flex>
      </Flex>

      <ShareConfirmDialog
        open={shareConfirmOpen}
        serverName={name}
        onOpenChange={setShareConfirmOpen}
        onConfirm={onShare}
      />

      {installation && status === "connected" && (
        <>
          <Separator size="4" />
          <Flex align="center" justify="between" wrap="wrap" gap="2">
            <Flex align="center" gap="3">
              <Text className="font-medium text-base">Tools</Text>
              <Badge color="gray" variant="soft" size="1">
                {countActiveTools(tools)}
              </Badge>
              <Flex gap="2">
                {counts.approved ? (
                  <Badge color="green" variant="soft" size="1">
                    {counts.approved} approved
                  </Badge>
                ) : null}
                {counts.needs_approval ? (
                  <Badge color="amber" variant="soft" size="1">
                    {counts.needs_approval} need approval
                  </Badge>
                ) : null}
                {counts.do_not_use ? (
                  <Badge color="red" variant="soft" size="1">
                    {counts.do_not_use} blocked
                  </Badge>
                ) : null}
              </Flex>
            </Flex>
            {canManage ? (
              <Flex gap="2" align="center">
                <Text color="gray" className="text-[13px]">
                  Set all:
                </Text>
                <Tooltip
                  content={toolSearch ? "Approve filtered" : "Approve all"}
                >
                  <IconButton
                    variant="soft"
                    color="green"
                    size="1"
                    disabled={bulkPending || filteredTools.length === 0}
                    onClick={() =>
                      setBulkApproval(
                        "approved",
                        toolSearch ? filteredTools : undefined,
                      )
                    }
                  >
                    <Check size={12} weight="bold" />
                  </IconButton>
                </Tooltip>
                <Tooltip
                  content={
                    toolSearch
                      ? "Require approval for filtered"
                      : "Require approval for all"
                  }
                >
                  <IconButton
                    variant="soft"
                    color="amber"
                    size="1"
                    disabled={bulkPending || filteredTools.length === 0}
                    onClick={() =>
                      setBulkApproval(
                        "needs_approval",
                        toolSearch ? filteredTools : undefined,
                      )
                    }
                  >
                    <Shield size={12} weight="bold" />
                  </IconButton>
                </Tooltip>
                <Tooltip content={toolSearch ? "Block filtered" : "Block all"}>
                  <IconButton
                    variant="soft"
                    color="red"
                    size="1"
                    disabled={bulkPending || filteredTools.length === 0}
                    onClick={() =>
                      setBulkApproval(
                        "do_not_use",
                        toolSearch ? filteredTools : undefined,
                      )
                    }
                  >
                    <Prohibit size={12} weight="bold" />
                  </IconButton>
                </Tooltip>
                <Separator orientation="vertical" />
                <Tooltip content="Refresh tools from server">
                  <IconButton
                    variant="soft"
                    color="gray"
                    size="1"
                    disabled={refreshPending}
                    onClick={refresh}
                  >
                    {refreshPending ? (
                      <Spinner size="1" />
                    ) : (
                      <ArrowClockwise size={12} weight="bold" />
                    )}
                  </IconButton>
                </Tooltip>
              </Flex>
            ) : (
              <Text color="gray" className="text-[13px]">
                Tool permissions are managed by the sharer.
              </Text>
            )}
          </Flex>

          {isLoading ? (
            <Flex align="center" justify="center" py="6">
              <Spinner size="2" />
            </Flex>
          ) : visibleTools.length === 0 ? (
            <Flex
              align="center"
              justify="center"
              direction="column"
              gap="1"
              py="6"
              className="rounded border border-gray-6 border-dashed"
            >
              {refreshPending ? (
                <Spinner size="1" />
              ) : (
                <>
                  <Text className="font-medium text-sm">
                    No tools discovered yet.
                  </Text>
                  <Text color="gray" className="text-[13px]">
                    Try refreshing, or check that the server is online.
                  </Text>
                </>
              )}
            </Flex>
          ) : (
            <Flex direction="column" gap="2">
              {visibleTools.length > 5 && (
                <TextField.Root
                  value={toolSearch}
                  onChange={(e) => setToolSearch(e.target.value)}
                  placeholder="Search tools..."
                  size="2"
                >
                  <TextField.Slot>
                    <MagnifyingGlass size={14} />
                  </TextField.Slot>
                  {toolSearch && (
                    <TextField.Slot>
                      <IconButton
                        variant="ghost"
                        size="1"
                        onClick={() => setToolSearch("")}
                      >
                        <X size={12} />
                      </IconButton>
                    </TextField.Slot>
                  )}
                </TextField.Root>
              )}
              {filteredTools.length === 0 ? (
                <Flex align="center" justify="center" py="4">
                  <Text color="gray" className="text-sm">
                    No tools match &ldquo;{toolSearch}&rdquo;
                  </Text>
                </Flex>
              ) : (
                filteredTools.map((tool) => (
                  <ToolRow
                    key={tool.tool_name}
                    tool={tool}
                    disabled={!canManage}
                    onChange={(approval_state) =>
                      setToolApproval({
                        toolName: tool.tool_name,
                        approval_state,
                      })
                    }
                  />
                ))
              )}
            </Flex>
          )}

          {removedCount > 0 && (
            <Flex justify="end">
              <Button
                variant="ghost"
                color="gray"
                size="1"
                onClick={() => setShowRemoved((v) => !v)}
              >
                {showRemoved ? "Hide" : "Show"} removed tools ({removedCount})
              </Button>
            </Flex>
          )}
        </>
      )}

      {installation && status !== "connected" && (
        <Flex
          direction="column"
          align="center"
          justify="center"
          gap="2"
          py="6"
          className="rounded border border-gray-6 border-dashed"
        >
          <Text className="font-medium text-sm">
            {status === "pending_oauth"
              ? "Finish connecting to start using this server."
              : "This server needs to be reconnected."}
          </Text>
          <Text color="gray" className="text-[13px]">
            Click Reconnect above to resume the OAuth flow.
          </Text>
        </Flex>
      )}
    </Flex>
  );
}

function ShareConfirmDialog({
  open,
  serverName,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  serverName: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Content maxWidth="480px">
        <AlertDialog.Title>Share with project?</AlertDialog.Title>
        <AlertDialog.Description className="text-sm">
          Everyone in this project — including autonomous agents — will be able
          to use <Text className="font-bold">{serverName}</Text> through your
          connection. Actions they take are attributed to your account on the
          connected service. Consider connecting a service account rather than a
          personal one. You can unshare at any time.
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button variant="solid" onClick={onConfirm}>
              <UsersThree size={12} />
              Share with project
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
