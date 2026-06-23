import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { toast } from "@posthog/ui/primitives/toast";
import { playCompletionSound } from "@posthog/ui/utils/sounds";
import { useEffect, useRef, useState } from "react";

// How long the reveal animation runs (kept in sync with `.canvas-reveal` in
// globals.css), after which the animation class is dropped.
const REVEAL_MS = 700;

// Celebrates the moment a generation lands: when a canvas that was generating
// settles with published code, play the user's completion chime, raise a
// success toast, and flag a one-shot reveal so the canvas can fade in. Fires
// for both the first build (empty → ready) and follow-up edits (ready →
// updated). Stays silent on plain navigation between already-built canvases.
export function useCanvasReadyCelebration(args: {
  code: string;
  isGenerating: boolean;
  canvasName: string;
}): { justRevealed: boolean } {
  const { code, isGenerating, canvasName } = args;
  const completionSound = useSettingsStore((s) => s.completionSound);
  const completionVolume = useSettingsStore((s) => s.completionVolume);

  // Track that a generation was in flight (so we only celebrate runs we saw
  // start) and whether the canvas already had code when it began (edit vs.
  // first build), for the right copy.
  const wasGeneratingRef = useRef(false);
  const hadCodeAtStartRef = useRef(false);
  const [justRevealed, setJustRevealed] = useState(false);

  const hasCode = !!code;

  useEffect(() => {
    if (isGenerating && !wasGeneratingRef.current) {
      wasGeneratingRef.current = true;
      hadCodeAtStartRef.current = hasCode;
    }
  }, [isGenerating, hasCode]);

  useEffect(() => {
    // Only fire once a tracked generation has settled with code in hand.
    if (!wasGeneratingRef.current || isGenerating || !hasCode) return;
    const wasEdit = hadCodeAtStartRef.current;
    wasGeneratingRef.current = false;

    setJustRevealed(true);
    const name = canvasName.trim();
    toast.success(wasEdit ? "✨ Canvas updated" : "✨ Canvas ready", {
      description: name
        ? `"${name}" is ready to explore.`
        : "Your canvas is ready to explore.",
    });
    playCompletionSound(completionSound, completionVolume);

    const timer = setTimeout(() => setJustRevealed(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [hasCode, isGenerating, canvasName, completionSound, completionVolume]);

  return { justRevealed };
}
