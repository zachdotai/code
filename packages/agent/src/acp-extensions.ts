/**
 * Re-export of ACP extensions from `@posthog/shared`.
 *
 * The canonical home for these constants/helpers is `@posthog/shared` so the
 * renderer can import them without pulling the entire `@posthog/agent` source
 * tree (which transitively imports `node:fs` and breaks the browser bundle).
 *
 * This file stays so existing `import { ... } from "@posthog/agent"` callers
 * keep working unchanged.
 */
export {
  isMethod,
  isNotification,
  POSTHOG_METHODS,
  POSTHOG_NOTIFICATIONS,
} from "@posthog/shared";
