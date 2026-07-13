import { RpcClient } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createPiRpcClient } from "./rpc-client";

describe("createPiRpcClient", () => {
  it("creates Pi's native RPC client for the harness entry", () => {
    const client = createPiRpcClient({
      cwd: "/workspace",
      model: "claude-opus-4-8",
      apiKey: "token",
      env: { POSTHOG_REGION: "us" },
    });

    expect(client).toBeInstanceOf(RpcClient);
    expect(client).toMatchObject({
      options: {
        cwd: "/workspace",
        model: "claude-opus-4-8",
        env: {
          POSTHOG_API_KEY: "token",
          POSTHOG_REGION: "us",
        },
        provider: "posthog",
      },
    });
  });
});
