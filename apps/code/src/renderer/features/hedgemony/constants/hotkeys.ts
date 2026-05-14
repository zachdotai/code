/**
 * Hedgemony hotkey catalog — the single source of truth for every key bound
 * on the map. `react-hotkeys-hook` calls live next to the handlers, but this
 * catalog is what both the in-game helper overlay and the global cheatsheet
 * render from, so renames stay in lockstep.
 */

export type HedgemonyHotkeyContext =
  | "camera"
  | "selection"
  | "builder"
  | "hedgehouse"
  | "hoglet"
  | "nest"
  | "audio"
  | "panels"
  | "dialog";

export interface HedgemonyHotkey {
  id: string;
  /** Comma-separated react-hotkeys-hook key string (first is what we display). */
  keys: string;
  description: string;
  context: HedgemonyHotkeyContext;
}

export const HEDGEMONY_HOTKEYS: HedgemonyHotkey[] = [
  // Camera
  {
    id: "camera-pan",
    keys: "w,a,s,d",
    description: "Pan map (hold Shift to boost)",
    context: "camera",
  },
  {
    id: "camera-pan-arrows",
    keys: "up,left,down,right",
    description: "Pan map with arrows",
    context: "camera",
  },
  {
    id: "camera-recall",
    keys: "f5",
    description: "Recall camera bookmark (F5 / F6 / F7)",
    context: "camera",
  },
  {
    id: "camera-save",
    keys: "shift+f5",
    description: "Save camera bookmark (Shift+F5 / F6 / F7)",
    context: "camera",
  },
  {
    id: "camera-fit",
    keys: "z",
    description: "Fit everything to view",
    context: "camera",
  },
  {
    id: "camera-reset",
    keys: "shift+z",
    description: "Reset view to default",
    context: "camera",
  },
  {
    id: "camera-center-selected",
    keys: "space",
    description: "Center camera on selection",
    context: "camera",
  },
  {
    id: "camera-fullscreen",
    keys: "f",
    description: "Toggle fullscreen",
    context: "camera",
  },
  {
    id: "camera-fullscreen-inapp",
    keys: "shift+f",
    description: "Toggle in-app fullscreen only",
    context: "camera",
  },

  // Selection
  {
    id: "selection-builder",
    keys: "f1",
    description: "Select Builder",
    context: "selection",
  },
  {
    id: "selection-hedgehouse",
    keys: "f2",
    description: "Select Hedgehouse",
    context: "selection",
  },
  {
    id: "selection-cycle-nest",
    keys: "f3",
    description: "Cycle nests (Shift+F3 reverse)",
    context: "selection",
  },
  {
    id: "selection-group-recall",
    keys: "1",
    description: "Recall control group 1–9",
    context: "selection",
  },
  {
    id: "selection-group-assign",
    keys: "mod+shift+1",
    description: "Assign selection to control group 1–9",
    context: "selection",
  },
  {
    id: "selection-cancel",
    keys: "escape",
    description: "Cancel placement / exit fullscreen / deselect",
    context: "selection",
  },

  // Builder commands (when builder selected)
  {
    id: "builder-build",
    keys: "b",
    description: "Build nest (guided)",
    context: "builder",
  },
  {
    id: "builder-quick",
    keys: "q",
    description: "Quick nest",
    context: "builder",
  },

  // Hedgehouse commands (when hedgehouse selected)
  {
    id: "hedgehouse-spawn",
    keys: "w",
    description: "Spawn wild hog",
    context: "hedgehouse",
  },

  // Hoglet commands (when one hoglet selected)
  {
    id: "hoglet-chat",
    keys: "c",
    description: "Toggle chat",
    context: "hoglet",
  },
  {
    id: "hoglet-open",
    keys: "o",
    description: "Open task in editor",
    context: "hoglet",
  },
  {
    id: "hoglet-home",
    keys: "h",
    description: "Send hoglet home",
    context: "hoglet",
  },
  {
    id: "hoglet-retire",
    keys: "r",
    description: "Retire hoglet",
    context: "hoglet",
  },

  // Nest commands (when nest selected)
  {
    id: "nest-save",
    keys: "s",
    description: "Save nest edits",
    context: "nest",
  },
  {
    id: "nest-archive",
    keys: "a",
    description: "Archive nest",
    context: "nest",
  },
  {
    id: "nest-relocate",
    keys: "r",
    description: "Relocate nest",
    context: "nest",
  },

  // Audio
  {
    id: "audio-music",
    keys: "m",
    description: "Mute / unmute music",
    context: "audio",
  },
  {
    id: "audio-sfx",
    keys: "shift+m",
    description: "Mute / unmute voice & SFX",
    context: "audio",
  },

  // Panels / helper
  {
    id: "panels-helper",
    keys: "shift+/",
    description: "Show hedgemony shortcuts",
    context: "panels",
  },

  // Dialogs
  {
    id: "dialog-submit",
    keys: "mod+enter",
    description: "Submit dialog",
    context: "dialog",
  },
  {
    id: "dialog-send",
    keys: "enter",
    description: "Send chat / answer (Shift+Enter for newline)",
    context: "dialog",
  },
];

export const HEDGEMONY_CONTEXT_LABELS: Record<HedgemonyHotkeyContext, string> =
  {
    camera: "Camera",
    selection: "Selection",
    builder: "Builder",
    hedgehouse: "Hedgehouse",
    hoglet: "Hoglet (selected)",
    nest: "Nest (selected)",
    audio: "Audio",
    panels: "Panels",
    dialog: "Dialogs",
  };

export const HEDGEMONY_CONTEXT_ORDER: HedgemonyHotkeyContext[] = [
  "camera",
  "selection",
  "builder",
  "hedgehouse",
  "hoglet",
  "nest",
  "panels",
  "audio",
  "dialog",
];
