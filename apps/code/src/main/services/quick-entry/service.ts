import { TypedEventEmitter } from "@posthog/shared";
import type { FoldersService } from "@posthog/workspace-server/services/folders/folders";
import { FOLDERS_SERVICE } from "@posthog/workspace-server/services/folders/identifiers";
import { inject, injectable } from "inversify";
import {
  createQuickEntryWindow,
  destroyQuickEntryWindow,
  hideQuickEntryWindow,
  isQuickEntryWindowFocused,
  isQuickEntryWindowVisible,
  registerQuickEntryShortcut,
  showQuickEntryWindow,
  unregisterQuickEntryShortcut,
} from "../../quick-entry-window";
import { logger } from "../../utils/logger";
import { showAndFocusMainWindow } from "../../window";
import { settingsStore } from "../settingsStore";
import {
  type CreateTaskRequest,
  QuickEntryServiceEvent,
  type QuickEntryServiceEvents,
  type RecentRepoEntry,
} from "./schemas";

const log = logger.scope("quick-entry");

const BLUR_HIDE_GRACE_MS = 120;
const SHOW_GRACE_MS = 200;

@injectable()
export class QuickEntryService extends TypedEventEmitter<QuickEntryServiceEvents> {
  private suppressBlurHide = false;
  private enabled: boolean;

  constructor(
    @inject(FOLDERS_SERVICE)
    private readonly foldersService: FoldersService,
  ) {
    super();
    this.enabled = settingsStore.get("quickEntryEnabled", true);
  }

  // Idempotent: window.ts guards against double-creation, and if the window
  // was destroyed (e.g. renderer crash) this recreates it.
  private ensureWindow(): void {
    createQuickEntryWindow({
      onBlur: () => this.handleBlur(),
    });
  }

  initialize(): void {
    this.ensureWindow();
    if (this.enabled) {
      registerQuickEntryShortcut(() => this.safeToggle());
    }
  }

  getEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    log.info("setEnabled", { enabled });
    this.enabled = enabled;
    settingsStore.set("quickEntryEnabled", enabled);
    if (enabled) {
      registerQuickEntryShortcut(() => this.safeToggle());
    } else {
      unregisterQuickEntryShortcut();
      this.hide();
    }
  }

  private safeToggle(): void {
    try {
      this.toggle();
    } catch (err) {
      log.error("Quick entry toggle failed", err);
    }
  }

  private handleBlur(): void {
    if (this.suppressBlurHide) return;
    // Child popups (dropdowns) briefly steal focus — grace period before hiding.
    setTimeout(() => {
      if (!isQuickEntryWindowVisible()) return;
      if (isQuickEntryWindowFocused()) return;
      this.hide();
    }, BLUR_HIDE_GRACE_MS);
  }

  isVisible(): boolean {
    return isQuickEntryWindowVisible();
  }

  toggle(): void {
    if (this.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    // Lazily recreate the window if it was destroyed (renderer crash, OOM).
    this.ensureWindow();
    this.suppressBlurHide = true;
    const ok = showQuickEntryWindow();
    if (!ok) {
      this.suppressBlurHide = false;
      return;
    }
    this.emit(QuickEntryServiceEvent.FocusInput, true);
    setTimeout(() => {
      this.suppressBlurHide = false;
    }, SHOW_GRACE_MS);
  }

  hide(): void {
    if (!isQuickEntryWindowVisible()) return;
    hideQuickEntryWindow();
    this.emit(QuickEntryServiceEvent.Hide, true);
  }

  requestCreateTask(request: CreateTaskRequest): void {
    this.hide();
    showAndFocusMainWindow();
    this.emit(QuickEntryServiceEvent.CreateTaskRequested, request);
  }

  async getRecentRepos(limit = 8): Promise<RecentRepoEntry[]> {
    const folders = await this.foldersService.getFolders();
    return folders
      .filter((f) => f.exists)
      .sort((a, b) => {
        const ta = new Date(a.lastAccessed).getTime();
        const tb = new Date(b.lastAccessed).getTime();
        return tb - ta;
      })
      .slice(0, limit)
      .map((f) => ({
        id: f.id,
        path: f.path,
        name: f.name,
        remoteUrl: f.remoteUrl,
      }));
  }

  dispose(): void {
    destroyQuickEntryWindow();
    log.info("Quick entry service disposed");
  }
}
