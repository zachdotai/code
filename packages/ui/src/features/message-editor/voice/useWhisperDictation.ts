import { isRecordingSupported } from "@posthog/ui/utils/customSound";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeToPcm16k } from "./pcm";
import { getWhisperClient } from "./whisperClient";

// Recording is capped so a forgotten open mic doesn't accumulate a huge clip
// (which would also make transcription slow). Matches the whisper.wasm demo.
const MAX_DICTATION_MS = 120_000;

// The bundled model is English-only (ggml-base.en); a multilingual model would
// instead use the host language or "auto".
const DICTATION_LANG = "en";

export type WhisperStatus = "idle" | "recording" | "transcribing";

export interface UseWhisperDictationOptions {
  // Fires when recording actually begins (after the mic is granted).
  onRecordingStart?: () => void;
  // Fires when the mic stops, before transcription runs.
  onRecordingStop?: () => void;
  // Fires with the final transcript once inference completes (non-empty only).
  onTranscript?: (text: string) => void;
  // Fires with a user-facing message when capture or transcription fails.
  onError?: (message: string) => void;
}

export interface UseWhisperDictation {
  status: WhisperStatus;
  isSupported: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

// Offline voice dictation driven by whisper.cpp (WASM). Records mic audio with
// MediaRecorder, decodes it to 16 kHz mono PCM, and hands it to the whisper
// worker for transcription. Unlike the old Web Speech engine this is batch, not
// streaming: text is delivered once, on stop — which also means it works fully
// offline and on the desktop host. Transcript placement is the caller's job (see
// `useEditorDictation`).
export function useWhisperDictation(
  options: UseWhisperDictationOptions = {},
): UseWhisperDictation {
  const [status, setStatus] = useState<WhisperStatus>("idle");

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  // Bumped every start(); an in-flight decode/transcription checks it and bails
  // if a newer session began or the component unmounted.
  const sessionRef = useRef(0);

  const isSupported = useMemo(() => isRecordingSupported(), []);

  const stopStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const transcribe = useCallback(async (blob: Blob, session: number) => {
    const alive = () => mountedRef.current && sessionRef.current === session;
    if (alive()) setStatus("transcribing");
    try {
      const pcm = await decodeToPcm16k(blob);
      // Nothing usable was captured — end quietly rather than erroring.
      if (!pcm || pcm.length === 0) return;
      const text = await getWhisperClient().transcribe(pcm, DICTATION_LANG);
      if (!alive()) return;
      const trimmed = text.trim();
      if (trimmed) optionsRef.current.onTranscript?.(trimmed);
    } catch (error) {
      if (alive()) {
        optionsRef.current.onError?.(transcriptionErrorMessage(error));
      }
    } finally {
      if (alive()) setStatus("idle");
    }
  }, []);

  const stop = useCallback(() => {
    clearTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, [clearTimer]);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    const session = ++sessionRef.current;
    // Kick the model load off now so it overlaps with the user speaking; the
    // first transcription then rarely waits on it.
    getWhisperClient()
      .warmup()
      .catch(() => {});
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // A newer session started (or we unmounted) while awaiting permission.
      if (!mountedRef.current || sessionRef.current !== session) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        clearTimer();
        recorderRef.current = null;
        stopStream();
        optionsRef.current.onRecordingStop?.();
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        void transcribe(blob, session);
      };
      recorder.start();
      recorderRef.current = recorder;
      setStatus("recording");
      optionsRef.current.onRecordingStart?.();
      timerRef.current = window.setInterval(() => {
        if (recorderRef.current?.state === "recording") stop();
      }, MAX_DICTATION_MS);
    } catch (error) {
      stopStream();
      if (mountedRef.current && sessionRef.current === session) {
        optionsRef.current.onError?.(micErrorMessage(error));
      }
    }
  }, [clearTimer, stop, stopStream, transcribe]);

  const toggle = useCallback(() => {
    // Ignore taps while a transcription is running; only recording/idle toggle.
    if (recorderRef.current) {
      stop();
    } else if (status !== "transcribing") {
      void start();
    }
  }, [start, stop, status]);

  // Tear down any in-flight capture on unmount so late events don't fire into an
  // unmounted component.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      sessionRef.current++;
      clearTimer();
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
        recorderRef.current = null;
      }
      stopStream();
    };
  }, [clearTimer, stopStream]);

  return {
    status,
    isSupported,
    isRecording: status === "recording",
    isTranscribing: status === "transcribing",
    start: () => void start(),
    stop,
    toggle,
  };
}

// getUserMedia rejects with a DOMException whose `name` tells us why.
function micErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was blocked. Allow it in your system settings.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found. Check that one is connected.";
  }
  return "Couldn't start voice input. Please try again.";
}

function transcriptionErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Voice transcription failed. Please try again.";
}
