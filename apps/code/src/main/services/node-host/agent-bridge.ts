import { TypedEventEmitter } from "@posthog/shared";
import {
  type AgentFileActivityPayload,
  AgentServiceEvent,
} from "@posthog/workspace-server/services/agent/schemas";
import { logger } from "../../utils/logger.js";
import type { NodeHostService } from "./service";

const log = logger.scope("agent-bridge");

interface AgentBridgeEvents {
  [AgentServiceEvent.LlmActivity]: undefined;
  [AgentServiceEvent.AgentFileActivity]: AgentFileActivityPayload;
  [AgentServiceEvent.SessionsIdle]: undefined;
}

/**
 * Main-process mirror of the agent events and calls main-side consumers used
 * to take straight from the in-process AgentService (usage monitor, workspace
 * branch watcher, archive/suspension cancellation, git session env, the
 * dev-toolbar snapshot) — now the service lives in the node-host
 * utilityProcess. Modeled on FileWatcherBridge: subscriptions are re-created
 * whenever the supervisor reports Ready, since a respawned process starts with
 * fresh event streams. `hasActiveSessions` stays synchronous for the usage
 * monitor by caching the LlmActivity/SessionsIdle transitions (refreshed with
 * an authoritative query on every resubscribe).
 */
export class AgentBridge extends TypedEventEmitter<AgentBridgeEvents> {
  #active = false;
  #subscriptions: Array<{ unsubscribe: () => void }> = [];

  constructor(private readonly nodeHost: NodeHostService) {
    super();
  }

  hasActiveSessions(): boolean {
    return this.#active;
  }

  cancelSessionsByTaskId(taskId: string): Promise<void> {
    return this.nodeHost
      .getClient()
      .agentInternal.cancelSessionsByTaskId.mutate({ taskId });
  }

  getSessionEnvForTask(taskId: string): Promise<Record<string, string>> {
    return this.nodeHost
      .getClient()
      .agentInternal.getSessionEnvForTask.query({ taskId });
  }

  getDebugSnapshot() {
    return this.nodeHost.getClient().agentInternal.getDebugSnapshot.query();
  }

  resubscribe(): void {
    for (const subscription of this.#subscriptions.splice(0)) {
      subscription.unsubscribe();
    }
    const client = this.nodeHost.getClient();

    client.agent.hasActiveSessions
      .query()
      .then((active) => {
        this.#active = active;
      })
      .catch(() => {});

    this.#subscriptions.push(
      client.agentInternal.onLlmActivity.subscribe(undefined, {
        onData: () => {
          this.#active = true;
          this.emit(AgentServiceEvent.LlmActivity, undefined);
        },
        onError: (error) => log.debug("llm-activity stream ended", { error }),
      }),
    );
    this.#subscriptions.push(
      client.agent.onSessionsIdle.subscribe(undefined, {
        onData: () => {
          this.#active = false;
          this.emit(AgentServiceEvent.SessionsIdle, undefined);
        },
        onError: (error) => log.debug("sessions-idle stream ended", { error }),
      }),
    );
    this.#subscriptions.push(
      client.agent.onAgentFileActivity.subscribe(undefined, {
        onData: (event) => {
          this.emit(
            AgentServiceEvent.AgentFileActivity,
            event as AgentFileActivityPayload,
          );
        },
        onError: (error) =>
          log.debug("agent-file-activity stream ended", { error }),
      }),
    );
  }
}
