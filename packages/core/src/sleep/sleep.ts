import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import {
  type IPowerManager,
  POWER_MANAGER_SERVICE,
  type PowerSaveBlockerType,
} from "@posthog/platform/power-manager";
import {
  type IWorkspaceSettings,
  WORKSPACE_SETTINGS_SERVICE,
} from "@posthog/platform/workspace-settings";
import { inject, injectable, preDestroy } from "inversify";

@injectable()
export class SleepService {
  private enabled: boolean;
  private keepDisplayAwake: boolean;
  private releaseBlocker: (() => void) | null = null;
  private activeBlockerType: PowerSaveBlockerType | null = null;
  private activeActivities = new Set<string>();
  private readonly log: ScopedLogger;

  constructor(
    @inject(POWER_MANAGER_SERVICE)
    private readonly powerManager: IPowerManager,
    @inject(WORKSPACE_SETTINGS_SERVICE)
    private readonly settings: IWorkspaceSettings,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
  ) {
    this.log = rootLogger.scope("sleep");
    this.enabled = this.settings.getPreventSleepWhileRunning();
    this.keepDisplayAwake = this.settings.getKeepDisplayAwakeWhileRunning();
  }

  setEnabled(enabled: boolean): void {
    this.log.info("setEnabled", { enabled });
    this.enabled = enabled;
    this.settings.setPreventSleepWhileRunning(enabled);
    this.updateBlocker();
  }

  getEnabled(): boolean {
    return this.enabled;
  }

  setKeepDisplayAwake(enabled: boolean): void {
    this.log.info("setKeepDisplayAwake", { enabled });
    this.keepDisplayAwake = enabled;
    this.settings.setKeepDisplayAwakeWhileRunning(enabled);
    this.updateBlocker();
  }

  getKeepDisplayAwake(): boolean {
    return this.keepDisplayAwake;
  }

  hasBuiltInBattery(): Promise<boolean> {
    return this.powerManager.hasBuiltInBattery();
  }

  acquire(activityId: string): void {
    this.activeActivities.add(activityId);
    this.updateBlocker();
  }

  release(activityId: string): void {
    this.activeActivities.delete(activityId);
    this.updateBlocker();
  }

  @preDestroy()
  cleanup(): void {
    this.stopBlocker();
  }

  private updateBlocker(): void {
    const desiredType = this.desiredBlockerType();
    if (desiredType === this.activeBlockerType) return;
    this.stopBlocker();
    if (desiredType) {
      this.startBlocker(desiredType);
    }
  }

  private desiredBlockerType(): PowerSaveBlockerType | null {
    if (!this.enabled || this.activeActivities.size === 0) return null;
    return this.keepDisplayAwake
      ? "prevent-display-sleep"
      : "prevent-app-suspension";
  }

  private startBlocker(type: PowerSaveBlockerType): void {
    this.releaseBlocker = this.powerManager.preventSleep(type);
    this.activeBlockerType = type;
    this.log.info("Started power save blocker", { type });
  }

  private stopBlocker(): void {
    if (!this.releaseBlocker) return;
    this.log.info("Stopping power save blocker", {
      type: this.activeBlockerType,
    });
    this.releaseBlocker();
    this.releaseBlocker = null;
    this.activeBlockerType = null;
  }
}
