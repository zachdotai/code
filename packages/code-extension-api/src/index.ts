export const POSTHOG_CODE_EXTENSION_API_VERSION = 1;

export type MaybePromise<T> = T | Promise<T>;

export interface Disposable {
  dispose(): void;
}

export type ExtensionCommandResult =
  | undefined
  | string
  | {
      message?: string;
    };

export interface ExtensionCommandContext {
  commandName: string;
  extensionId: string;
  taskId?: string;
  repoPath?: string | null;
}

export interface ExtensionCommandOptions {
  description?: string;
  input?: { hint?: string };
  argumentHint?: string;
  handler: (
    args: string | undefined,
    context: ExtensionCommandContext,
  ) => MaybePromise<ExtensionCommandResult>;
}

export type ExtensionViewLocation = "sidebar";

export interface ExtensionWebview {
  html: string;
  postMessage(message: unknown): Promise<boolean>;
  onDidReceiveMessage(handler: (message: unknown) => void): Disposable;
}

export interface ExtensionViewContext {
  extensionId: string;
  viewId: string;
  readExtensionFile(path: string): Promise<string>;
}

export interface ExtensionViewOptions {
  location: ExtensionViewLocation;
  title: string;
  icon?: string;
  entry?: string;
  html?: string;
}

export interface PostHogCodeExtensionApi {
  registerCommand(name: string, options: ExtensionCommandOptions): Disposable;
  registerView(id: string, options: ExtensionViewOptions): Disposable;
}

export type BridgeMessageLevel = "debug" | "info" | "warning" | "error";

export interface ExtensionBridgeBaseMessage {
  type: string;
  requestId?: string;
}

export interface ExtensionBridgeReadyMessage
  extends ExtensionBridgeBaseMessage {
  type: "posthogCode.ready";
  version: typeof POSTHOG_CODE_EXTENSION_API_VERSION;
}

export interface ExtensionBridgeLogMessage extends ExtensionBridgeBaseMessage {
  type: "posthogCode.log";
  level?: BridgeMessageLevel;
  message: string;
  data?: unknown;
}

export interface ExtensionBridgeNotifyMessage
  extends ExtensionBridgeBaseMessage {
  type: "posthogCode.notify";
  level?: Exclude<BridgeMessageLevel, "debug">;
  message: string;
}

export type ExtensionViewToHostMessage =
  | ExtensionBridgeReadyMessage
  | ExtensionBridgeLogMessage
  | ExtensionBridgeNotifyMessage;

export interface ExtensionBridgeHostReadyMessage
  extends ExtensionBridgeBaseMessage {
  type: "posthogCode.hostReady";
  version: typeof POSTHOG_CODE_EXTENSION_API_VERSION;
  extensionId: string;
  viewId: string;
  theme?: "light" | "dark";
}

export interface ExtensionBridgeResponseMessage
  extends ExtensionBridgeBaseMessage {
  type: "posthogCode.response";
  requestId: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
}

export type ExtensionHostToViewMessage =
  | ExtensionBridgeHostReadyMessage
  | ExtensionBridgeResponseMessage;

export interface PostHogCodeBridgeOptions {
  targetWindow?: Window;
  targetOrigin?: string;
}

export interface PostHogCodeBridge {
  ready(): void;
  log(message: string, data?: unknown, level?: BridgeMessageLevel): void;
  notify(message: string, level?: Exclude<BridgeMessageLevel, "debug">): void;
  postMessage(message: ExtensionViewToHostMessage): void;
}

export function createPostHogCodeBridge(
  options: PostHogCodeBridgeOptions = {},
): PostHogCodeBridge {
  const targetWindow = options.targetWindow ?? window.parent;
  const targetOrigin = options.targetOrigin ?? "*";

  const postMessage = (message: ExtensionViewToHostMessage): void => {
    targetWindow.postMessage(message, targetOrigin);
  };

  return {
    ready() {
      postMessage({
        type: "posthogCode.ready",
        version: POSTHOG_CODE_EXTENSION_API_VERSION,
      });
    },
    log(message, data, level = "info") {
      postMessage({ type: "posthogCode.log", level, message, data });
    },
    notify(message, level = "info") {
      postMessage({ type: "posthogCode.notify", level, message });
    },
    postMessage,
  };
}
