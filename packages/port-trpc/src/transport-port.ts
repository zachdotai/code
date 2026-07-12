/**
 * Minimal structural view over the MessagePort flavours this transport runs
 * on: the DOM MessagePort (Electron renderer today, a Web Worker on web
 * later), Electron's MessagePortMain (main and utility processes), and Node's
 * worker_threads port (tests). Adapters normalize them so the link and server
 * never import electron and never assume a runtime.
 */
export interface TransportPort {
  postMessage(message: unknown): void;
  /** Register a message-payload listener; returns an unsubscribe. */
  onMessage(listener: (data: unknown) => void): () => void;
  /** Fires when the other end of the channel is gone (peer closed or died). */
  onClose(listener: () => void): () => void;
  start(): void;
  close(): void;
}

/**
 * DOM-shaped MessagePort. Real DOM MessagePorts (and Node's web-compat
 * globals) are structurally assignable; declared here so this package needs
 * neither the DOM lib nor @types/node consumers.
 */
export interface DomMessagePortLike {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message" | "close",
    listener: (event: { data?: unknown }) => void,
  ): void;
  removeEventListener(
    type: "message" | "close",
    listener: (event: { data?: unknown }) => void,
  ): void;
  start(): void;
  close(): void;
}

export function fromDomPort(port: DomMessagePortLike): TransportPort {
  return {
    postMessage: (message) => port.postMessage(message),
    onMessage: (listener) => {
      const handler = (event: { data?: unknown }) => listener(event.data);
      port.addEventListener("message", handler);
      return () => port.removeEventListener("message", handler);
    },
    onClose: (listener) => {
      const handler = () => listener();
      port.addEventListener("close", handler);
      return () => port.removeEventListener("close", handler);
    },
    start: () => port.start(),
    close: () => port.close(),
  };
}

/**
 * Electron MessagePortMain shape (an EventEmitter whose "message" event
 * carries `{ data }`). Structural so this package never imports electron.
 */
export interface MessagePortMainLike {
  postMessage(message: unknown): void;
  addListener(
    event: "message",
    listener: (event: { data: unknown }) => void,
  ): unknown;
  addListener(event: "close", listener: () => void): unknown;
  removeListener(
    event: "message",
    listener: (event: { data: unknown }) => void,
  ): unknown;
  removeListener(event: "close", listener: () => void): unknown;
  start(): void;
  close(): void;
}

export function fromMessagePortMain(port: MessagePortMainLike): TransportPort {
  return {
    postMessage: (message) => port.postMessage(message),
    onMessage: (listener) => {
      const handler = (event: { data: unknown }) => listener(event.data);
      port.addListener("message", handler);
      return () => port.removeListener("message", handler);
    },
    onClose: (listener) => {
      const handler = () => listener();
      port.addListener("close", handler);
      return () => port.removeListener("close", handler);
    },
    start: () => port.start(),
    close: () => port.close(),
  };
}
