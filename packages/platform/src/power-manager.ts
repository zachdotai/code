export type PowerSaveBlockerType =
  | "prevent-app-suspension"
  | "prevent-display-sleep";

export interface IPowerManager {
  onResume(handler: () => void): () => void;
  preventSleep(type: PowerSaveBlockerType): () => void;
  hasBuiltInBattery(): Promise<boolean>;
}

export const POWER_MANAGER_SERVICE = Symbol.for(
  "posthog.platform.powerManager",
);
