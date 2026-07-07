import type { ICloudTaskConnectivity } from "@posthog/core/cloud-task/identifiers";
import type { WorkspaceClient } from "@posthog/workspace-client/client";
import { inject, injectable } from "inversify";
import { WORKSPACE_CLIENT } from "../di/tokens";

/**
 * Feeds the main-process cloud-run stream watcher real connectivity from the
 * workspace-server ConnectivityService (the single connectivity source, shared
 * with auth's ConnectivityPortAdapter). Tracks the offline→online edge so the
 * watcher can pause while offline and resume the instant the network returns.
 */
@injectable()
export class CloudTaskConnectivityPortAdapter
  implements ICloudTaskConnectivity
{
  private online = true;
  private readonly onlineHandlers = new Set<() => void>();

  constructor(
    @inject(WORKSPACE_CLIENT)
    private readonly workspace: WorkspaceClient,
  ) {
    this.workspace.connectivity.onStatusChange.subscribe(undefined, {
      onData: (status) => this.setOnline(status.isOnline),
      onError: () => {},
    });
    void this.workspace.connectivity.getStatus
      .query()
      .then((status) => {
        this.online = status.isOnline;
      })
      .catch(() => {});
  }

  isOnline(): boolean {
    return this.online;
  }

  onOnline(callback: () => void): () => void {
    this.onlineHandlers.add(callback);
    return () => {
      this.onlineHandlers.delete(callback);
    };
  }

  private setOnline(next: boolean): void {
    const cameOnline = !this.online && next;
    this.online = next;
    if (!cameOnline) return;
    // Snapshot: a handler may unsubscribe itself (e.g. a watcher that resumes).
    for (const handler of [...this.onlineHandlers]) {
      handler();
    }
  }
}
