import Store from "electron-store";
import { getUserDataDir } from "./env";

interface GpuRecoverySchema {
  // When true, the next launch boots with hardware acceleration disabled
  // (software rendering) because the GPU process was crash-looping.
  disableHardwareAcceleration: boolean;
}

// Constructed lazily so this module can be imported from bootstrap.ts before
// the userData env var is set — getUserDataDir() is only read at call time.
function gpuRecoveryStore(): Store<GpuRecoverySchema> {
  return new Store<GpuRecoverySchema>({
    name: "gpu-recovery",
    cwd: getUserDataDir(),
    defaults: { disableHardwareAcceleration: false },
  });
}

/** Whether a prior session asked the app to fall back to software rendering. */
export function isHardwareAccelerationDisabled(): boolean {
  return gpuRecoveryStore().get("disableHardwareAcceleration", false);
}

/**
 * Persist the software-rendering fallback so the next launch disables hardware
 * acceleration. Takes effect on restart — Electron can only toggle hardware
 * acceleration before the app is ready.
 */
export function persistDisableHardwareAcceleration(): void {
  gpuRecoveryStore().set("disableHardwareAcceleration", true);
}
