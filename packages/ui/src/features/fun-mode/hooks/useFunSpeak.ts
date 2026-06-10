import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { useCallback } from "react";
import { funSpeak } from "../funSpeak";

export function useFunSpeak() {
  const mode = useSettingsStore((s) => s.funMode);
  return useCallback((text: string) => funSpeak(text, mode), [mode]);
}
