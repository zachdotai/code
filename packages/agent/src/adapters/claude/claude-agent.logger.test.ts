import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import { Logger } from "../../utils/logger";
import { ClaudeAcpAgent } from "./claude-agent";

describe("ClaudeAcpAgent logging", () => {
  it("emits through the host logger from options so enrichment logs reach the host sink", () => {
    const onLog = vi.fn();
    const hostLogger = new Logger({
      debug: true,
      prefix: "[PostHog Agent]",
      onLog,
    });
    const client = {} as unknown as AgentSideConnection;

    const agent = new ClaudeAcpAgent(client, {
      logger: hostLogger.child("ClaudeAcpAgent"),
    });
    agent.logger.info("[apm] agent enrich", { lines: 4 });

    expect(onLog).toHaveBeenCalledWith(
      "info",
      expect.stringContaining("ClaudeAcpAgent"),
      "[apm] agent enrich",
      { lines: 4 },
    );
  });
});
