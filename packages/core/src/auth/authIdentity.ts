import type { AuthState } from "./schemas";

export function getAuthIdentity(authState: AuthState): string | null {
  if (authState.status !== "authenticated" || !authState.cloudRegion) {
    return null;
  }
  return `${authState.cloudRegion}:${authState.currentProjectId ?? "none"}`;
}

/**
 * Storage scope for per-user local state (e.g. browser tabs), stable across
 * project/org switches. Null when signed out or when the user's identity
 * could not be resolved — callers treat null as "don't touch persisted state".
 */
export function getAccountScopeKey(authState: AuthState): string | null {
  if (
    authState.status !== "authenticated" ||
    !authState.cloudRegion ||
    !authState.accountKey
  ) {
    return null;
  }
  return `${authState.cloudRegion}:${authState.accountKey}`;
}
