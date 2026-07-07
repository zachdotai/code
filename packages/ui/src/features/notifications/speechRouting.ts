import type { SpeechKind } from "@posthog/core/speech/identifiers";
import type { SpokenFocusMode } from "@posthog/ui/features/settings/settingsStore";
import type { NotificationChannel } from "./routeNotification";

export type { SpeechKind };

export interface SpeechGateSettings {
  enabled: boolean;
  needsInput: boolean;
  completion: boolean;
  progress: boolean;
  focusMode: SpokenFocusMode;
}

/**
 * Whether a spoken line should play, given the focus-routing channel (from
 * routeNotification) and the user's spoken-notification settings. Pure so the
 * policy is exhaustively unit-tested without the DI graph.
 *
 * needs-input lines ignore focus mode entirely — a blocker is the whole point
 * of the feature, so it's never suppressed for being on screen.
 */
export function shouldSpeak(
  kind: SpeechKind,
  channel: NotificationChannel,
  s: SpeechGateSettings,
): boolean {
  if (!s.enabled) return false;

  const kindEnabled =
    kind === "needs_input"
      ? s.needsInput
      : kind === "done"
        ? s.completion
        : s.progress;
  if (!kindEnabled) return false;

  if (kind === "needs_input") return true;

  switch (s.focusMode) {
    case "always":
      return true;
    case "unviewed_task":
      return channel !== "suppress";
    case "app_unfocused":
      return channel === "native";
  }
}
