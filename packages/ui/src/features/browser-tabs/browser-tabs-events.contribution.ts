import type { Contribution } from "@posthog/di/contribution";
import { inject, injectable } from "inversify";
import {
  BROWSER_TABS_CLIENT,
  type BrowserTabsClient,
} from "./browserTabsClient";
import { applyRemoteSnapshot, registerSnapshotFetcher } from "./tabsSync";

/**
 * Seeds the renderer tab snapshot at startup and keeps it live via the
 * snapshot-change subscription, so a mutation in any window is reflected here.
 * Applied through the tabsSync gate: pushes are dropped while this window has
 * writes in flight, so an echo of our own mutation can't rewind newer local
 * state (see tabsSync.ts).
 */
@injectable()
export class BrowserTabsEventsContribution implements Contribution {
  private subscription: { unsubscribe: () => void } | null = null;

  constructor(
    @inject(BROWSER_TABS_CLIENT)
    private readonly client: BrowserTabsClient,
  ) {}

  start(): void {
    // Lets tabsSync re-pull the authoritative snapshot after a FAILED write
    // (a failed mutation emits no snapshotChange, so nothing else reconciles).
    registerSnapshotFetcher(() => this.client.getSnapshot());

    void this.client
      .getSnapshot()
      .then((snapshot) => applyRemoteSnapshot(snapshot))
      .catch(() => undefined);

    // Replace any prior handle so a repeated start() can't leak a subscription.
    this.subscription?.unsubscribe();
    this.subscription = this.client.onSnapshotChange({
      onData: (snapshot) => applyRemoteSnapshot(snapshot),
    });
  }

  stop(): void {
    registerSnapshotFetcher(null);
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}
