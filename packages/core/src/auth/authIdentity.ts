import type { AccountScope } from "@posthog/shared";
import type { AuthState } from "./schemas";

export function getAuthIdentity(authState: AuthState): string | null {
  if (authState.status !== "authenticated" || !authState.cloudRegion) {
    return null;
  }
  return `${authState.cloudRegion}:${authState.currentProjectId ?? "none"}`;
}

/**
 * Account owning per-user local state (e.g. browser tabs), stable across
 * project/org switches.
 *
 * Three-way result: a scope when the signed-in identity is known, null when
 * signed out, and undefined while the identity cannot be determined yet —
 * a session still restoring, or an authenticated session whose user-context
 * fetch has not resolved an accountKey. On undefined, callers must leave
 * per-user state as it is rather than treat the user as signed out: the
 * distinction is "we don't know who this is yet" vs "nobody is signed in".
 */
export function getAccountScope(
  authState: AuthState,
): AccountScope | null | undefined {
  if (authState.status === "restoring") {
    return undefined;
  }
  if (authState.status === "authenticated") {
    if (!authState.cloudRegion || !authState.accountKey) {
      return undefined;
    }
    return {
      accountKey: authState.accountKey,
      cloudRegion: authState.cloudRegion,
    };
  }
  return null;
}
