import type { FunMode } from "@posthog/ui/features/settings/settingsStore";

// Bottom of array renders first; later entries layer on top.
export const ACCESSORIES_BY_FUN_MODE: Record<FunMode, readonly string[]> = {
  none: [],
  lolcat: ["chef"],
  pirate: ["eyepatch", "cowboy", "parrot"],
};

export const FILTER_BY_FUN_MODE: Record<FunMode, string | undefined> = {
  none: undefined,
  lolcat: "sepia(1) saturate(1.5)",
  pirate: undefined,
};
