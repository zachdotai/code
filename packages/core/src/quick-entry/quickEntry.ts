/**
 * Host-neutral surface of the quick-entry widget that the host-router (and
 * therefore portable settings UI) depends on. The concrete implementation is
 * host-specific (it owns an Electron BrowserWindow and a global shortcut) and
 * lives in the desktop host; only this interface is portable.
 */

export const DEFAULT_QUICK_ENTRY_ACCELERATOR = "CommandOrControl+Shift+H";

export interface QuickEntryShortcutState {
  /** Electron accelerator string, e.g. "CommandOrControl+Shift+H". */
  accelerator: string;
  /**
   * Whether the shortcut is currently registered with the OS. False when the
   * widget is disabled, the accelerator is invalid, or another app owns the
   * combination (e.g. Raycast on Alt+Space).
   */
  registered: boolean;
}

export interface IQuickEntryService {
  getEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  getShortcut(): QuickEntryShortcutState;
  setShortcut(accelerator: string): QuickEntryShortcutState;
}
