import { describe, expect, it } from "vitest";
import type { NotificationChannel } from "./routeNotification";
import {
  type SpeechGateSettings,
  type SpeechKind,
  shouldSpeak,
} from "./speechRouting";

const base: SpeechGateSettings = {
  enabled: true,
  needsInput: true,
  completion: true,
  progress: true,
  focusMode: "always",
};

describe("shouldSpeak", () => {
  it("is silent when the feature is disabled", () => {
    expect(
      shouldSpeak("needs_input", "native", { ...base, enabled: false }),
    ).toBe(false);
  });

  it.each<[SpeechKind, keyof SpeechGateSettings]>([
    ["needs_input", "needsInput"],
    ["done", "completion"],
    ["progress", "progress"],
  ])("respects the per-kind toggle for %s", (kind, key) => {
    expect(shouldSpeak(kind, "native", { ...base, [key]: false })).toBe(false);
  });

  it("always speaks needs-input regardless of focus", () => {
    for (const channel of ["suppress", "toast", "native"] as const) {
      expect(
        shouldSpeak("needs_input", channel, {
          ...base,
          focusMode: "app_unfocused",
        }),
      ).toBe(true);
    }
  });

  it.each<[NotificationChannel, boolean]>([
    ["suppress", false],
    ["toast", true],
    ["native", true],
  ])("unviewed_task: channel %s -> %s", (channel, expected) => {
    expect(
      shouldSpeak("done", channel, { ...base, focusMode: "unviewed_task" }),
    ).toBe(expected);
  });

  it.each<[NotificationChannel, boolean]>([
    ["suppress", false],
    ["toast", false],
    ["native", true],
  ])("app_unfocused: channel %s -> %s", (channel, expected) => {
    expect(
      shouldSpeak("done", channel, { ...base, focusMode: "app_unfocused" }),
    ).toBe(expected);
  });

  it("always mode speaks on every channel", () => {
    for (const channel of ["suppress", "toast", "native"] as const) {
      expect(
        shouldSpeak("done", channel, { ...base, focusMode: "always" }),
      ).toBe(true);
    }
  });
});
