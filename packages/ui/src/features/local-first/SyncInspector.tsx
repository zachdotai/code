import { SYNC_ENGINE } from "@posthog/core/local-store/sync/identifiers";
import type { SyncEngine } from "@posthog/core/local-store/sync/syncEngine";
import { useService } from "@posthog/di/react";
import { Button, Flex } from "@radix-ui/themes";
import {
  useIsOnline,
  useOutboxEntries,
  useSyncStatus,
} from "./useLocalFirstStatus";

function formatTime(iso: string | null): string {
  if (!iso) return "never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}

/**
 * Debug surface for the local-first engine: leadership, per-collection
 * freshness/errors, and the durable outbox. Lives in Advanced settings so
 * "why is this stale?" is a glance instead of a log dive.
 */
export function SyncInspector() {
  const engine = useService<SyncEngine>(SYNC_ENGINE);
  const status = useSyncStatus();
  const entries = useOutboxEntries();
  const online = useIsOnline();

  const collections = Object.entries(status.collections);

  return (
    <Flex direction="column" gap="2" className="text-xs">
      <Flex align="center" gap="3">
        <span>
          Engine: {engine.namespace ?? "stopped"} ·{" "}
          {status.isLeader ? "leader" : "follower"} ·{" "}
          {online ? "online" : "offline"}
        </span>
        <Button size="1" variant="soft" onClick={() => engine.pokeAll()}>
          Sync now
        </Button>
      </Flex>

      {collections.length === 0 ? (
        <span className="text-gray-9">No collections syncing yet.</span>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="text-gray-9">
              <th className="pr-2 font-normal">Collection</th>
              <th className="pr-2 font-normal">Last synced</th>
              <th className="pr-2 font-normal">State</th>
              <th className="font-normal">Error</th>
            </tr>
          </thead>
          <tbody>
            {collections.map(([name, c]) => (
              <tr key={name}>
                <td className="pr-2 font-mono">{name}</td>
                <td className="pr-2">{formatTime(c.lastSyncedAt)}</td>
                <td className="pr-2">
                  {c.syncing
                    ? "syncing"
                    : c.failureCount > 0
                      ? `failing ×${c.failureCount}`
                      : "idle"}
                </td>
                <td className="max-w-64 truncate">{c.lastError ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div>
        <span className="text-gray-9">
          Outbox: {entries.length === 0 ? "empty" : `${entries.length} entries`}
        </span>
        {entries.length > 0 ? (
          <table className="w-full text-left">
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="pr-2 font-mono">
                    {entry.collection}/{entry.op}
                  </td>
                  <td className="pr-2 font-mono">{entry.recordId}</td>
                  <td className="pr-2">
                    {entry.state}
                    {entry.attempts > 0 ? ` (×${entry.attempts})` : ""}
                  </td>
                  <td className="max-w-64 truncate">{entry.lastError ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </Flex>
  );
}
