import type {
  AuthOrgProjectPreferenceRecord,
  AuthPreferenceRecord,
  AuthSessionRecord,
  ConnectivityStatus,
  IAuthConnectivity,
  IAuthPreferenceStore,
  IAuthSessionStore,
  IAuthTokenCipher,
  PersistAuthSessionRecord,
} from "@posthog/core/auth/identifiers";
import type { IPowerManager } from "@posthog/platform/power-manager";
import type { CloudRegion } from "@posthog/shared";

// Web counterparts of the desktop auth adapters. Desktop persists the session
// in workspace-server SQLite behind a machine-bound node:crypto cipher and
// listens to OS power/network events; the browser keeps the same interfaces
// over localStorage and web platform events.

const SESSION_KEY = "posthog-code:auth-session";
const PREFERENCES_KEY = "posthog-code:auth-preferences";

export class WebAuthSessionStore implements IAuthSessionStore {
  getCurrent(): AuthSessionRecord | null {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthSessionRecord;
    } catch {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  saveCurrent(input: PersistAuthSessionRecord): void {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(input));
  }

  clearCurrent(): void {
    window.localStorage.removeItem(SESSION_KEY);
  }
}

interface StoredPreferences {
  accounts: Record<string, AuthPreferenceRecord>;
  orgProjects: Record<string, AuthOrgProjectPreferenceRecord>;
}

export class WebAuthPreferenceStore implements IAuthPreferenceStore {
  get(
    accountKey: string,
    cloudRegion: CloudRegion,
  ): AuthPreferenceRecord | null {
    return this.read().accounts[`${accountKey}:${cloudRegion}`] ?? null;
  }

  save(input: AuthPreferenceRecord): void {
    const preferences = this.read();
    preferences.accounts[`${input.accountKey}:${input.cloudRegion}`] = input;
    this.write(preferences);
  }

  getOrgProject(
    accountKey: string,
    cloudRegion: CloudRegion,
    orgId: string,
  ): AuthOrgProjectPreferenceRecord | null {
    return (
      this.read().orgProjects[`${accountKey}:${cloudRegion}:${orgId}`] ?? null
    );
  }

  saveOrgProject(input: AuthOrgProjectPreferenceRecord): void {
    const preferences = this.read();
    preferences.orgProjects[
      `${input.accountKey}:${input.cloudRegion}:${input.orgId}`
    ] = input;
    this.write(preferences);
  }

  private read(): StoredPreferences {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return { accounts: {}, orgProjects: {} };
    try {
      return JSON.parse(raw) as StoredPreferences;
    } catch {
      return { accounts: {}, orgProjects: {} };
    }
  }

  private write(preferences: StoredPreferences): void {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  }
}

// The desktop cipher keys AES off the machine id, which has no browser
// equivalent — any key we could derive would sit in the same localStorage as
// the ciphertext. Pass-through: the refresh token is protected by the origin
// boundary alone (XSS is the threat model either way). Revisit if the web
// host moves to cookie-based sessions.
export const webAuthTokenCipher: IAuthTokenCipher = {
  encrypt: (plaintext) => plaintext,
  decrypt: (encrypted) => encrypted,
};

export class WebAuthConnectivity implements IAuthConnectivity {
  getStatus(): ConnectivityStatus {
    return { isOnline: navigator.onLine };
  }

  onStatusChange(handler: (status: ConnectivityStatus) => void): () => void {
    const online = () => handler({ isOnline: true });
    const offline = () => handler({ isOnline: false });
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }
}

export const webPowerManager: IPowerManager = {
  onResume(handler: () => void): () => void {
    // Closest web analog to an OS resume signal: the tab becoming visible
    // again also covers waking from sleep.
    const listener = () => {
      if (document.visibilityState === "visible") handler();
    };
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },

  preventSleep(_reason: string): () => void {
    // Screen Wake Lock is the only browser primitive here; the request can be
    // refused (hidden tab, unsupported browser), which callers must treat the
    // same as no lock at all.
    const wakeLock = (navigator as { wakeLock?: WakeLock }).wakeLock;
    let released = false;
    let sentinel: WakeLockSentinel | null = null;
    wakeLock
      ?.request("screen")
      .then((lock) => {
        if (released) return lock.release();
        sentinel = lock;
      })
      .catch(() => {});
    return () => {
      released = true;
      void sentinel?.release().catch(() => {});
    };
  },

  hasBuiltInBattery(): Promise<boolean> {
    return Promise.resolve(false);
  },
};
