import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "../utils/logger";

/**
 * Shape of `task.options.add_ons` as it travels from the Django Task model
 * through `_meta.addOns` on a `newSession` ACP request. Keys are add-on names
 * registered with the {@link AddOnRegistry}; values are opaque option blobs
 * that each add-on validates with its own `parseOptions` implementation.
 */
export type AddOnConfig = Record<string, Record<string, unknown>>;

export type AddOnAdapter = "claude" | "codex";

export interface AddOnContext {
  cwd: string;
  adapter: AddOnAdapter;
  logger: Logger;
}

export interface AddOnContribution {
  env?: Record<string, string>;
  systemPromptAppend?: string;
  preToolUse?: HookCallback[];
  postToolUse?: HookCallback[];
}

export interface AddOnDefinition<TOptions = Record<string, unknown>> {
  /** Unique name. Matches the key under `task.options.add_ons`. */
  name: string;
  /**
   * Adapters this add-on supports. Omit to support every adapter; specify
   * a subset (e.g. `["claude"]`) to be silently skipped on unsupported ones.
   * Codex cannot honor `preToolUse`/`postToolUse` slots since `codex-acp`
   * has no pre/post-tool interception point — add-ons that need command
   * interception declare `supportedAdapters: ["claude"]`.
   */
  supportedAdapters?: AddOnAdapter[];
  /**
   * Validate and shape the raw options blob. Throw to signal invalid input —
   * the registry will skip the add-on and log a warning rather than abort the
   * whole session.
   */
  parseOptions(rawOptions: unknown): TOptions;
  /**
   * Idempotent setup that must complete before the session starts. Use for
   * resolving binaries on disk, downloading assets, etc. Throw to fail loudly.
   */
  prepare?(ctx: AddOnContext, options: TOptions): Promise<void> | void;
  /** Produce the session-level contribution. */
  contribute(
    ctx: AddOnContext,
    options: TOptions,
  ): Promise<AddOnContribution> | AddOnContribution;
}
