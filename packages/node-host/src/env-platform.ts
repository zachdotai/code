import path from "node:path";
import type { IAppMeta } from "@posthog/platform/app-meta";
import type { IBundledResources } from "@posthog/platform/bundled-resources";
import type { IStoragePaths } from "@posthog/platform/storage-paths";

/**
 * Platform adapters derived from environment variables the main process sets
 * on the fork — the same env-not-electron seam apps/code's bootstrap already
 * uses for its own utility singletons. POSTHOG_CODE_DATA_DIR / _IS_DEV /
 * _VERSION are inherited from main's process.env; the app path and log paths
 * are added by the supervisor because only main can compute them.
 */

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`node-host: required env ${key} is not set`);
  }
  return value;
}

export function createEnvBundledResources(
  env: NodeJS.ProcessEnv,
): IBundledResources {
  const base = requireEnv(env, "POSTHOG_CODE_APP_PATH");
  return {
    resolve: (relativePath: string) => path.join(base, relativePath),
  };
}

export function createEnvAppMeta(env: NodeJS.ProcessEnv): IAppMeta {
  return {
    version: env.POSTHOG_CODE_VERSION ?? "0.0.0",
    isProduction: env.POSTHOG_CODE_IS_DEV !== "true",
    platform: process.platform,
    arch: process.arch,
  };
}

export function createEnvStoragePaths(env: NodeJS.ProcessEnv): IStoragePaths {
  const appDataPath = requireEnv(env, "POSTHOG_CODE_DATA_DIR");
  return {
    appDataPath,
    logsPath: env.POSTHOG_CODE_LOGS_PATH ?? path.join(appDataPath, "logs"),
    logFolderPath:
      env.POSTHOG_CODE_LOG_FOLDER_PATH ?? path.join(appDataPath, "logs"),
  };
}
