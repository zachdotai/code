import { isMac } from "@posthog/ui/utils/platform";

/**
 * Conversions between Electron accelerator strings ("CommandOrControl+Shift+H")
 * and the hotkey format used by keyboard-shortcuts display helpers
 * ("mod+shift+h"), plus capture of a KeyboardEvent as an accelerator.
 */

const ACCELERATOR_MODIFIER_TO_HOTKEY: Record<string, string> = {
  commandorcontrol: "mod",
  cmdorctrl: "mod",
  command: "mod",
  cmd: "mod",
  super: "mod",
  meta: "mod",
  control: "ctrl",
  ctrl: "ctrl",
  alt: "alt",
  option: "alt",
  altgr: "alt",
  shift: "shift",
};

export function acceleratorToHotkey(accelerator: string): string {
  return accelerator
    .split("+")
    .map((part) => {
      const key = part.trim().toLowerCase();
      return ACCELERATOR_MODIFIER_TO_HOTKEY[key] ?? key;
    })
    .join("+");
}

const FUNCTION_KEY_PATTERN = /^F([1-9]|1\d|2[0-4])$/;

function keyboardEventKeyToAcceleratorKey(event: {
  code: string;
  key: string;
}): string | null {
  const { code, key } = event;
  // Prefer the physical code for letters/digits so the combo is stable
  // across keyboard layouts and modifier-altered `key` values (⌥H → "˙").
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Space") return "Space";
  if (FUNCTION_KEY_PATTERN.test(code)) return code;
  switch (key) {
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "Enter":
      return "Enter";
    case "Tab":
      return "Tab";
    case "Backspace":
      return "Backspace";
    case "Delete":
      return "Delete";
    case "Home":
      return "Home";
    case "End":
      return "End";
    case "PageUp":
      return "PageUp";
    case "PageDown":
      return "PageDown";
  }
  if (key.length === 1 && key !== " ") return key.toUpperCase();
  return null;
}

/**
 * Convert a keydown event into an Electron accelerator, or null when the
 * combination cannot be a global shortcut: a bare modifier, an unmappable
 * key, or a key without any of Cmd/Ctrl/Alt (except function keys, which
 * work unmodified).
 */
export function keyboardEventToAccelerator(event: {
  code: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): string | null {
  if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return null;
  const key = keyboardEventKeyToAcceleratorKey(event);
  if (!key) return null;
  const hasPrimaryModifier = event.metaKey || event.ctrlKey || event.altKey;
  if (!hasPrimaryModifier && !FUNCTION_KEY_PATTERN.test(key)) return null;
  const parts: string[] = [];
  if (event.metaKey) parts.push(isMac ? "Command" : "Super");
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}
