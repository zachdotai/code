import { AddCustomServerForm } from "@posthog/ui/features/mcp-server-manager/AddCustomServerForm";
import type { CustomServerInput } from "@posthog/ui/features/mcp-server-manager/useMcpConnect";
import { Dialog } from "@radix-ui/themes";
import type { PendingMcpConnect } from "./agentBuilderStore";

/**
 * Modal for the agent builder's `connect_mcp` punch-out. The agent parks its
 * turn and supplies a prefilled name/url; the user reviews + completes the
 * connect (OAuth / api key) here — the agent never sees the credentials. On
 * success the connection is written onto the target agent's spec and the
 * session woken. A modal (vs. the inline secret punch-out) because the connect
 * form is a full form, not a one-line input.
 */
export function AgentBuilderMcpConnectDialog({
  pending,
  busy,
  onSubmit,
  onCancel,
}: {
  pending: PendingMcpConnect | null;
  busy: boolean;
  onSubmit: (values: CustomServerInput) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog.Root
      open={!!pending}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <Dialog.Content maxWidth="520px" size="3">
        <Dialog.Title className="text-base">Connect an MCP server</Dialog.Title>
        <Dialog.Description className="mb-4 text-sm" color="gray">
          {pending?.purpose ??
            "Connect a server for this agent. You complete the sign-in — the agent builder never sees your credentials."}
        </Dialog.Description>
        {pending ? (
          <AddCustomServerForm
            pending={busy}
            hideHeader
            initialValues={{ name: pending.name, url: pending.url }}
            onSubmit={onSubmit}
            onBack={onCancel}
          />
        ) : null}
      </Dialog.Content>
    </Dialog.Root>
  );
}
