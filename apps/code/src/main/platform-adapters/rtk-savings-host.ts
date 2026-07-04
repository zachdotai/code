import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import {
  BUNDLED_RTK_DIR,
  bundledRtkBinName,
  resolveRtkSavings,
} from "@posthog/agent/server/rtk-savings";
import type { RtkSavingsHost } from "@posthog/core/usage/identifiers";
import type { IBundledResources } from "@posthog/platform/bundled-resources";
import { machineIdSync } from "node-machine-id";

/**
 * Reads the bundled rtk binary's cumulative savings tally for the desktop
 * gauge report. The counter id hashes machine id + OS username because rtk's
 * database lives in the OS user's app-data dir: two OS users on one machine
 * are two distinct counters, and mixing their readings under one id would
 * corrupt the consumer-side differencing.
 */
export function createRtkSavingsHost(
  bundledResources: IBundledResources,
): RtkSavingsHost {
  let counterId: string | null = null;

  return {
    async readGauge() {
      const binary = bundledResources.resolve(
        `${BUNDLED_RTK_DIR}/${bundledRtkBinName()}`,
      );
      if (!existsSync(binary)) return null;

      const summary = await resolveRtkSavings({
        resolveBinary: () => binary,
      });
      if (!summary) return null;

      counterId ??= createHash("sha256")
        .update(`${machineIdSync()}:${userInfo().username}`)
        .digest("hex");
      return { counterId, ...summary };
    },
  };
}
