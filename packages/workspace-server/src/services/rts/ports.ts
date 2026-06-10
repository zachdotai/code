// Narrow ports inverting the RTS services' dependencies on host services so
// they can live in workspace-server without importing apps/code. The host
// binds RTS_AUTH to its AuthService and RTS_SETTINGS to its settings store.

type RtsFetchLike = (
  input: string | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface RtsAuthState {
  cloudRegion: "us" | "eu" | null;
  currentProjectId: number | null;
}

export interface RtsAuth {
  getValidAccessToken(): Promise<{ accessToken: string; apiHost: string }>;
  authenticatedFetch(
    fetchImpl: RtsFetchLike,
    input: string | Request,
    init?: RequestInit,
  ): Promise<Response>;
  getState(): RtsAuthState;
}

export interface RendererSettingsSnapshot {
  lastUsedAdapter?: unknown;
  lastUsedModel?: unknown;
  lastUsedReasoningEffort?: unknown;
}

export interface RtsSettings {
  getRtsMaxTicksPerHour(): number;
  getRtsSignalIngestionEnabled(): boolean;
  setRtsSignalIngestionEnabled(value: boolean): void;
  getWorktreeLocation(): string;
  /**
   * Decrypted snapshot of the renderer settings store, used to seed hoglet
   * runtime preferences from the operator's last-used task settings. Null
   * when unavailable.
   */
  getRendererSettingsSnapshot(): RendererSettingsSnapshot | null;
}
