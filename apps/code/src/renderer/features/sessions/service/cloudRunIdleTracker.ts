import type { AgentSession } from "@features/sessions/stores/sessionStore";
import { isNotification, POSTHOG_NOTIFICATIONS } from "@posthog/agent";
import { isJsonRpcRequest } from "@shared/types/session-events";

interface CloudRunIdleScanState {
  nextEventIndex: number;
  seenCurrentRunStart: boolean;
  idle: boolean;
}

export interface CloudRunIdleEvidenceSnapshot {
  taskRunId: string;
  eventCount: number;
  agentIdleForRunId: string | undefined;
  scanState?: CloudRunIdleScanState;
}

export interface CloudRunIdleRestoreResult {
  agentIdleForRunId: string | undefined;
}

export interface CloudRunIdleScanResult {
  idle: boolean;
  /**
   * True when the result came from the scan (i.e. not the
   * `agentIdleForRunId` fast path) AND the scan proved idleness. Callers
   * use this to cache the result back into the store without issuing a
   * redundant write when the live flag was already set.
   */
  shouldCacheToStore: boolean;
}

/**
 * Tracks idleness for cloud runs incrementally so repeated `in_progress`
 * updates don't re-scan the full event list each time (the O(N²) hot loop
 * that motivated this helper). Each session has at most one scan state;
 * callers update it via `markBusy`/`markIdle` on live events and read it
 * via `evaluateIdle`, which only walks events added since the last call.
 *
 * Deliberately independent of `isPromptPending`: `retryCloudTaskWatch()`
 * forcibly clears that flag on reconnect, so trusting it would let recovery
 * dispatch a queued follow-up while a remote turn is still running.
 */
export class CloudRunIdleTracker {
  private scanStates = new Map<string, CloudRunIdleScanState>();

  clear(): void {
    this.scanStates.clear();
  }

  delete(taskRunId: string): void {
    this.scanStates.delete(taskRunId);
  }

  /**
   * Marks the run as busy. Sets `seenCurrentRunStart: true` even if a
   * `RUN_STARTED` notification was never observed — a `session/prompt`
   * being sent or replayed is itself proof that the run has started for
   * scan purposes. Practically a no-op for cloud sessions (RUN_STARTED
   * always precedes prompts), but it keeps the local executeCloudPrompt
   * path correct without forcing an artificial event into the log.
   */
  markBusy(session: AgentSession): void {
    this.scanStates.set(session.taskRunId, {
      nextEventIndex: session.events.length,
      seenCurrentRunStart: true,
      idle: false,
    });
  }

  markIdle(session: AgentSession): void {
    this.scanStates.set(session.taskRunId, {
      nextEventIndex: session.events.length,
      seenCurrentRunStart: true,
      idle: true,
    });
  }

  capture(session: AgentSession): CloudRunIdleEvidenceSnapshot {
    const scanState = this.scanStates.get(session.taskRunId);
    return {
      taskRunId: session.taskRunId,
      eventCount: session.events.length,
      agentIdleForRunId: session.agentIdleForRunId,
      scanState: scanState ? { ...scanState } : undefined,
    };
  }

  restoreAfterFailedSend(
    snapshot: CloudRunIdleEvidenceSnapshot,
    session: AgentSession,
  ): CloudRunIdleRestoreResult | undefined {
    for (let i = snapshot.eventCount; i < session.events.length; i += 1) {
      const acpMsg = session.events[i];
      if (
        acpMsg &&
        isJsonRpcRequest(acpMsg.message) &&
        acpMsg.message.method === "session/prompt"
      ) {
        return undefined;
      }
    }

    const currentScanState = this.scanStates.get(snapshot.taskRunId);
    const stillAtFailedSendMarker =
      currentScanState?.nextEventIndex === snapshot.eventCount &&
      currentScanState.seenCurrentRunStart &&
      !currentScanState.idle;
    if (!stillAtFailedSendMarker) {
      return undefined;
    }

    if (snapshot.scanState) {
      this.scanStates.set(snapshot.taskRunId, { ...snapshot.scanState });
    } else {
      this.scanStates.delete(snapshot.taskRunId);
    }

    return { agentIdleForRunId: snapshot.agentIdleForRunId };
  }

  /**
   * Returns idleness for this exact run. Walks only events added since the
   * previous call so repeated invocations are O(delta), not O(N).
   *
   * The fast path hits `agentIdleForRunId` (the live signal set by the
   * `turn_complete` handler). The scan is a fallback for sessions
   * recreated from logs where the live flag was never set because the
   * no-delta dedup guard skipped reprocessing.
   *
   * `becameIdle` is true when this call flipped the run from not-idle to
   * idle. Callers use it to cache the result back into the store
   * (`agentIdleForRunId`) without issuing a redundant write.
   */
  evaluateIdle(session: AgentSession): CloudRunIdleScanResult {
    if (session.agentIdleForRunId === session.taskRunId) {
      return { idle: true, shouldCacheToStore: false };
    }

    let scanState = this.scanStates.get(session.taskRunId);
    if (!scanState || scanState.nextEventIndex > session.events.length) {
      scanState = {
        nextEventIndex: 0,
        seenCurrentRunStart: false,
        idle: false,
      };
    }

    for (let i = scanState.nextEventIndex; i < session.events.length; i += 1) {
      const acpMsg = session.events[i];
      if (!acpMsg) continue;
      const msg = acpMsg.message;
      if (
        "method" in msg &&
        isNotification(msg.method, POSTHOG_NOTIFICATIONS.RUN_STARTED)
      ) {
        const params = (msg as { params?: { runId?: unknown } }).params;
        if (params?.runId === session.taskRunId) {
          scanState.seenCurrentRunStart = true;
          scanState.idle = false;
        }
        continue;
      }
      if (!scanState.seenCurrentRunStart) {
        continue;
      }
      if (isJsonRpcRequest(msg) && msg.method === "session/prompt") {
        scanState.idle = false;
        continue;
      }
      if (
        "method" in msg &&
        isNotification(msg.method, POSTHOG_NOTIFICATIONS.TURN_COMPLETE)
      ) {
        scanState.idle = true;
      }
    }

    scanState.nextEventIndex = session.events.length;
    this.scanStates.set(session.taskRunId, scanState);

    return { idle: scanState.idle, shouldCacheToStore: scanState.idle };
  }
}
