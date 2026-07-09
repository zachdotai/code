import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { promisify } from "node:util";
import type {
  IPowerManager,
  PowerSaveBlockerType,
} from "@posthog/platform/power-manager";
import { powerMonitor, powerSaveBlocker } from "electron";
import { injectable } from "inversify";

const execFileAsync = promisify(execFile);

@injectable()
export class ElectronPowerManager implements IPowerManager {
  public onResume(handler: () => void): () => void {
    powerMonitor.on("resume", handler);
    return () => powerMonitor.off("resume", handler);
  }

  public preventSleep(type: PowerSaveBlockerType): () => void {
    const id = powerSaveBlocker.start(type);
    return () => {
      if (powerSaveBlocker.isStarted(id)) {
        powerSaveBlocker.stop(id);
      }
    };
  }

  public hasBuiltInBattery(): Promise<boolean> {
    memoizedBuiltInBattery ??= detectBuiltInBattery().catch(() => false);
    return memoizedBuiltInBattery;
  }
}

let memoizedBuiltInBattery: Promise<boolean> | null = null;

async function detectBuiltInBattery(): Promise<boolean> {
  switch (process.platform) {
    case "darwin": {
      const { stdout } = await execFileAsync("ioreg", [
        "-rc",
        "AppleSmartBattery",
      ]);
      return stdout.includes("AppleSmartBattery");
    }
    case "win32": {
      const { stdout } = await execFileAsync("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[bool](Get-CimInstance -ClassName Win32_Battery)",
      ]);
      return stdout.trim().toLowerCase() === "true";
    }
    case "linux": {
      const supplies = await readdir("/sys/class/power_supply");
      return supplies.some((name) => name.startsWith("BAT"));
    }
    default:
      return false;
  }
}
