export const LOGS_SERVICE = Symbol.for("posthog.workspace.logsService");

export interface ILogsService {
  fetchS3Logs(logUrl: string): Promise<string | null>;
  readLocalLogs(taskRunId: string): Promise<string | null>;
  /**
   * Read a window of the log ending at `endOffset` bytes (end of file when
   * null), at most `maxBytes` long, returning whole ndjson lines plus the byte
   * offset they start at. Page backwards by passing the previous `startOffset`
   * as the next `endOffset`. `null` if there's no local log.
   */
  readLocalLogsWindow(
    taskRunId: string,
    endOffset: number | null,
    maxBytes: number,
  ): Promise<{
    content: string;
    startOffset: number;
    endOffset: number;
    headReached: boolean;
  } | null>;
  writeLocalLogs(taskRunId: string, content: string): Promise<void>;
}
