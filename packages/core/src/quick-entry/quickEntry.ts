/**
 * Host-neutral surface of the quick-entry widget that the host-router (and
 * therefore portable settings UI) depends on. The concrete implementation is
 * host-specific (it owns an Electron BrowserWindow and a global shortcut) and
 * lives in the desktop host; only this interface is portable.
 */
export interface IQuickEntryService {
  getEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}
