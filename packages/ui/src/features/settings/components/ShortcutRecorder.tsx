import { formatHotkeyParts } from "@posthog/ui/features/command/keyboard-shortcuts";
import {
  acceleratorToHotkey,
  keyboardEventToAccelerator,
} from "@posthog/ui/utils/accelerator";
import { Button, Kbd, Text } from "@radix-ui/themes";
import { useState } from "react";

interface ShortcutRecorderProps {
  /** Current Electron accelerator string, e.g. "CommandOrControl+Shift+H". */
  accelerator: string;
  onChange: (accelerator: string) => void;
}

/**
 * Button that displays the current shortcut and, when clicked, captures the
 * next key combination pressed. Escape or blur cancels recording. Combos
 * without a Cmd/Ctrl/Alt modifier are ignored (they can't be global
 * shortcuts), keeping recording active until a valid one lands.
 */
export function ShortcutRecorder({
  accelerator,
  onChange,
}: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(false);
      return;
    }
    const next = keyboardEventToAccelerator(event);
    if (next) {
      setRecording(false);
      onChange(next);
    }
  };

  return (
    <Button
      variant="outline"
      color="gray"
      size="1"
      onClick={() => setRecording(true)}
      onKeyDown={handleKeyDown}
      onBlur={() => setRecording(false)}
      aria-label={recording ? "Recording shortcut" : "Change shortcut"}
    >
      {recording ? (
        <Text className="text-[12px]">Press shortcut…</Text>
      ) : (
        formatHotkeyParts(acceleratorToHotkey(accelerator)).map(
          (part, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: parts can repeat (e.g. "+") and never reorder
            <Kbd key={`${part}-${index}`} size="1">
              {part}
            </Kbd>
          ),
        )
      )}
    </Button>
  );
}
