import type { RendererSettingsSnapshot, RtsSettings } from "./ports";

// Module-level settings facade for RTS code that predates DI configuration.
// The host calls setRtsSettings() during composition with an adapter over its
// settings store; reads before that fall back to safe defaults.

let impl: RtsSettings | null = null;

export function setRtsSettings(settings: RtsSettings): void {
  impl = settings;
}

export function getRtsMaxTicksPerHour(): number {
  return impl?.getRtsMaxTicksPerHour() ?? 60;
}

export function getRtsSignalIngestionEnabled(): boolean {
  return impl?.getRtsSignalIngestionEnabled() ?? false;
}

export function setRtsSignalIngestionEnabled(value: boolean): void {
  impl?.setRtsSignalIngestionEnabled(value);
}

export function getWorktreeLocation(): string {
  if (!impl) {
    throw new Error("RTS settings not configured: worktree location unknown");
  }
  return impl.getWorktreeLocation();
}

export function getRendererSettingsSnapshot(): RendererSettingsSnapshot | null {
  return impl?.getRendererSettingsSnapshot() ?? null;
}
