import { useMcpUiToolsStore } from "@features/mcp-apps/stores/mcpUiToolsStore";
import { useTRPC } from "@renderer/trpc/client";
import { useSubscription } from "@trpc/tanstack-react-query";

export function useMcpUiToolsSubscription(): void {
  const trpcReact = useTRPC();
  const setToolKeys = useMcpUiToolsStore((s) => s.setToolKeys);

  useSubscription(
    trpcReact.mcpApps.onDiscoveryComplete.subscriptionOptions(undefined, {
      onData: (event) => {
        setToolKeys(event.toolKeys);
      },
    }),
  );
}
