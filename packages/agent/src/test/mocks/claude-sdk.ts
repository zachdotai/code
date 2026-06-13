import type {
  Query,
  SDKMessage,
  SDKResultError,
  SDKResultSuccess,
} from "@anthropic-ai/claude-agent-sdk";
import type { Mock } from "vitest";
import { vi } from "vitest";

export interface MockQueryHelpers {
  sendMessage: (message: SDKMessage) => void;
  complete: (result?: SDKResultSuccess) => void;
  sendError: (result: SDKResultError) => void;
  simulateError: (error: Error) => void;
  queueError: (error: Error) => void;
  simulateTimeout: () => void;
  isAborted: () => boolean;
}

export interface MockQuery extends Omit<Query, "interrupt"> {
  _mockHelpers: MockQueryHelpers;
  _abortController: AbortController;
  interrupt: Mock<() => Promise<void>>;
}

export interface CreateMockQueryOptions {
  abortController?: AbortController;
}

export function createMockQuery(
  options: CreateMockQueryOptions = {},
): MockQuery {
  const abortController = options.abortController ?? new AbortController();
  let resolveNext: ((value: IteratorResult<SDKMessage, void>) => void) | null =
    null;
  let rejectNext: ((error: Error) => void) | null = null;
  let isDone = false;
  let queuedError: Error | null = null;
  let isTimedOut = false;

  const createNextPromise = (): Promise<IteratorResult<SDKMessage, void>> => {
    if (isDone) {
      return Promise.resolve({ value: undefined, done: true as const });
    }
    if (queuedError) {
      const error = queuedError;
      queuedError = null;
      return Promise.reject(error);
    }
    if (isTimedOut) {
      return new Promise(() => {});
    }
    return new Promise((resolve, reject) => {
      resolveNext = resolve;
      rejectNext = reject;

      abortController.signal.addEventListener("abort", () => {
        isDone = true;
        resolve({ value: undefined, done: true as const });
      });
    });
  };

  const mockQuery: MockQuery = {
    next: vi.fn(() => createNextPromise()),
    return: vi.fn(() => {
      isDone = true;
      return Promise.resolve({ value: undefined, done: true as const });
    }),
    throw: vi.fn((error: Error) => {
      isDone = true;
      return Promise.reject(error);
    }),
    [Symbol.asyncIterator]() {
      return this;
    },
    interrupt: vi.fn(async () => {
      abortController.abort();
      isDone = true;
      if (resolveNext) {
        resolveNext({ value: undefined, done: true as const });
        resolveNext = null;
        rejectNext = null;
      }
    }),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setMaxThinkingTokens: vi.fn().mockResolvedValue(undefined),
    supportedCommands: vi.fn().mockResolvedValue([]),
    supportedModels: vi.fn().mockResolvedValue([]),
    mcpServerStatus: vi.fn().mockResolvedValue([]),
    accountInfo: vi.fn().mockResolvedValue({}),
    rewindFiles: vi.fn().mockResolvedValue({ canRewind: false }),
    setMcpServers: vi
      .fn()
      .mockResolvedValue({ added: [], removed: [], errors: {} }),
    streamInput: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    initializationResult: vi.fn().mockResolvedValue({}),
    reconnectMcpServer: vi.fn().mockResolvedValue(undefined),
    toggleMcpServer: vi.fn().mockResolvedValue(undefined),
    supportedAgents: vi.fn().mockResolvedValue([]),
    stopTask: vi.fn().mockResolvedValue(undefined),
    applyFlagSettings: vi.fn().mockResolvedValue(undefined),
    getContextUsage: vi.fn().mockResolvedValue({}),
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: vi
      .fn()
      .mockResolvedValue({}),
    reloadPlugins: vi.fn().mockResolvedValue(undefined),
    reloadSkills: vi.fn().mockResolvedValue(undefined),
    seedReadState: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    backgroundTasks: vi.fn().mockResolvedValue([]),
    [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
    _abortController: abortController,
    _mockHelpers: {
      sendMessage(message: SDKMessage) {
        if (resolveNext && !isDone) {
          resolveNext({ value: message, done: false });
          resolveNext = null;
          rejectNext = null;
        }
      },
      complete(result?: SDKResultSuccess) {
        isDone = true;
        if (resolveNext) {
          if (result) {
            resolveNext({ value: result, done: false });
          } else {
            resolveNext({ value: undefined, done: true });
          }
          resolveNext = null;
          rejectNext = null;
        }
      },
      sendError(result: SDKResultError) {
        isDone = true;
        if (resolveNext) {
          resolveNext({ value: result, done: false });
          resolveNext = null;
          rejectNext = null;
        }
      },
      simulateError(error: Error) {
        if (rejectNext) {
          rejectNext(error);
          resolveNext = null;
          rejectNext = null;
        }
      },
      queueError(error: Error) {
        queuedError = error;
      },
      simulateTimeout() {
        isTimedOut = true;
      },
      isAborted() {
        return abortController.signal.aborted;
      },
    },
  };

  return mockQuery;
}
