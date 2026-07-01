import { useCallback, useEffect, useRef, useState } from "react";
import {
  describeSpeechError,
  getSpeechRecognitionCtor,
  isSpeechRecognitionSupported,
  readTranscriptDelta,
  type SpeechRecognitionLike,
  type TranscriptDelta,
} from "./webSpeech";

export type VoiceStatus = "idle" | "listening";

export interface UseVoiceDictationOptions {
  // Fires once when recognition actually begins (after the mic is granted).
  onStart?: () => void;
  // Fires on every recognition update with the newly-final and interim text.
  onTranscript?: (delta: TranscriptDelta) => void;
  // Fires when listening ends after having started — manual stop or engine end.
  onStop?: () => void;
  // Fires with a user-facing message when recognition fails.
  onError?: (message: string) => void;
}

export interface UseVoiceDictation {
  status: VoiceStatus;
  isSupported: boolean;
  isListening: boolean;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

// Drives the browser Web Speech API for dictation: owns the recognition
// instance, translates its events into the caller's callbacks, and guarantees
// teardown so events never fire into an unmounted component. Transcript text is
// intentionally not accumulated here — the caller decides where it goes (see
// `useEditorDictation`).
export function useVoiceDictation(
  options: UseVoiceDictationOptions = {},
): UseVoiceDictation {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Tracks whether `onstart` fired, so `onend` only reports a stop for sessions
  // that genuinely started (a permission denial ends without ever starting).
  const listeningRef = useRef(false);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const isSupported = isSpeechRecognitionSupported();

  const detach = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.onstart = null;
    recognitionRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      // Already stopping — the pending `onend` will settle state.
    }
  }, []);

  const start = useCallback(() => {
    if (recognitionRef.current) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      optionsRef.current.onError?.("Voice input isn't supported in this app.");
      return;
    }

    const recognition = new Ctor();
    recognition.lang =
      typeof navigator !== "undefined"
        ? navigator.language || "en-US"
        : "en-US";
    // Keep listening across pauses so a held key or an open mic captures whole
    // thoughts, not just the first phrase.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      listeningRef.current = true;
      setStatus("listening");
      optionsRef.current.onStart?.();
    };

    recognition.onresult = (event) => {
      optionsRef.current.onTranscript?.(readTranscriptDelta(event));
    };

    recognition.onerror = (event) => {
      const message = describeSpeechError(event.error);
      // The spec fires `onend` right after `onerror`, which resets state and
      // notifies the caller — here we only surface the message.
      if (message) optionsRef.current.onError?.(message);
    };

    recognition.onend = () => {
      const wasListening = listeningRef.current;
      listeningRef.current = false;
      detach();
      setStatus("idle");
      if (wasListening) optionsRef.current.onStop?.();
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // `start()` throws if the engine is mid-teardown; reset so the next
      // attempt gets a fresh instance.
      detach();
      listeningRef.current = false;
      setStatus("idle");
    }
  }, [detach]);

  const toggle = useCallback(() => {
    if (recognitionRef.current) {
      stop();
    } else {
      start();
    }
  }, [start, stop]);

  // Abort any in-flight recognition on unmount before its handlers can fire.
  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.onstart = null;
        try {
          recognition.abort();
        } catch {
          // Nothing to abort.
        }
      }
      recognitionRef.current = null;
      listeningRef.current = false;
    };
  }, []);

  return {
    status,
    isSupported,
    isListening: status === "listening",
    start,
    stop,
    toggle,
  };
}
