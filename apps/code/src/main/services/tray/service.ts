import type { IMainWindow } from "@posthog/platform/main-window";
import type { ITray } from "@posthog/platform/tray";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import {
  AgentServiceEvent,
  type RunningCountChangedPayload,
} from "../agent/schemas";
import type { AgentService } from "../agent/service";

const log = logger.scope("tray");

@injectable()
export class TrayService {
  private initialized = false;
  private readonly onRunningCountChanged = (
    payload: RunningCountChangedPayload,
  ) => this.refresh(payload.count);

  constructor(
    @inject(MAIN_TOKENS.Tray) private readonly tray: ITray,
    @inject(MAIN_TOKENS.AgentService) private readonly agents: AgentService,
    @inject(MAIN_TOKENS.MainWindow) private readonly window: IMainWindow,
  ) {}

  public initialize(): void {
    if (this.initialized) return;
    if (!this.tray.isSupported()) {
      log.info("Tray not supported on this platform; skipping");
      return;
    }

    this.tray.show();
    this.tray.onClick(() => this.handleClick());
    this.agents.on(
      AgentServiceEvent.RunningCountChanged,
      this.onRunningCountChanged,
    );
    this.refresh(this.agents.getRunningSessionCount());
    this.initialized = true;
    log.info("Tray initialized");
  }

  public dispose(): void {
    if (!this.initialized) return;
    this.agents.off(
      AgentServiceEvent.RunningCountChanged,
      this.onRunningCountChanged,
    );
    this.tray.hide();
    this.initialized = false;
  }

  private handleClick(): void {
    if (this.window.isMinimized()) this.window.restore();
    this.window.focus();
  }

  private refresh(count: number): void {
    this.tray.setBadgeCount(count);
    this.tray.setTooltip(`${count} running agent${count === 1 ? "" : "s"}`);
  }
}
