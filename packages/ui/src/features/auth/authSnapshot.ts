import { type AuthState, authStateSchema } from "@posthog/core/auth/schemas";

/**
 * Last-known auth state, persisted locally so cold boots render the shell
 * (and the local-first pools behind it) before the real auth check completes.
 * Contains no secrets — tokens live in the main process secure store; this is
 * region/org/project shape only. The real auth state reconciles in the
 * background and wipes everything on identity mismatch.
 */
const STORAGE_KEY = "posthog-code:auth-snapshot:v1";

export function loadAuthSnapshot(): AuthState | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = authStateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.status !== "authenticated") {
      return null;
    }
    return { ...parsed.data, bootstrapComplete: true };
  } catch {
    return null;
  }
}

export function saveAuthSnapshot(state: AuthState): void {
  if (state.status !== "authenticated" || !state.bootstrapComplete) return;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota/serialization failures just mean the next boot shows the spinner.
  }
}

export function clearAuthSnapshot(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
