import { fileURLToPath } from "node:url";
import {
  RpcClient,
  type RpcClientOptions,
} from "@earendil-works/pi-coding-agent";

export type PiRpcClient = RpcClient;

export type PiRpcClientOptions = Pick<
  RpcClientOptions,
  "cwd" | "env" | "model"
> & {
  /** PostHog token passed only to the isolated RPC host process. */
  apiKey?: string;
};

/**
 * Create a native Pi RPC client backed by the PostHog harness.
 *
 * The client owns an isolated child process. Call `start()` before sending
 * commands and `stop()` when the run is finished.
 */
export function createPiRpcClient(
  options: PiRpcClientOptions = {},
): PiRpcClient {
  const { apiKey, env, ...rpcOptions } = options;

  return new RpcClient({
    ...rpcOptions,
    cliPath: fileURLToPath(new URL("./rpc-host.js", import.meta.url)),
    env: {
      ...env,
      ...(apiKey ? { POSTHOG_API_KEY: apiKey } : {}),
    },
    provider: "posthog",
  });
}
