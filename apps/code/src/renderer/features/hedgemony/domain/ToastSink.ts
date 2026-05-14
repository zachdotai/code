/**
 * Narrow interface over the toast UI used by hedgemony mutations for
 * rollback notifications and undo confirmations. Sonner is one
 * implementation; tests use spies.
 */
export interface ToastAction {
  label: string;
  onClick(): void;
}

export interface ToastOptions {
  action?: ToastAction;
}

export interface ToastSink {
  info(message: string, options?: ToastOptions): void;
  error(message: string): void;
}
