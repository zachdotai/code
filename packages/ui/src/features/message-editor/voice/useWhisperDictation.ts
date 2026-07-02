import { isRecordingSupported } from "@posthog/ui/utils/customSound";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeToPcm16k, WHISPER_SAMPLE_RATE } from "./pcm";
import { getWhisperClient } from "./whisperClient";
import { isWhisperEngineAvailable } from "./whisperModule";

// Recording is capped so a forgotten open mic doesn't accumulate a huge clip
// (which would also make the final pass slow). Matches the whisper.wasm demo.
const MAX_DICTATION_MS = 120_000;

// Streaming cadence. MediaRecorder emits a chunk every STREAM_CHUNK_MS so recent
// audio is available quickly; every STREAM_INTERVAL_MS we attempt a partial pass
// (skipped while a prior pass runs, so slow inference throttles itself).
const STREAM_CHUNK_MS = 250;
const STREAM_INTERVAL_MS = 400;
// Each partial transcribes only the audio since the last commit, capped to this
// window so passes stay fast and constant-time no matter how long the clip is.
// Once the window exceeds the cap, its text is committed and the window resets —
// that's what keeps updates arriving every ~half-second instead of slowing down.
const STREAM_WINDOW_SEC = 8;

// The bundled model is English-only (ggml-tiny.en); a multilingual model would
// instead use the host language or "auto".
const DICTATION_LANG = "en";

export type WhisperStatus = "idle" | "recording" | "transcribing";

export interface UseWhisperDictationOptions {
  // Fires when recording actually begins (after the mic is granted).
  onRecordingStart?: () => void;
  // Fires when the mic stops, before the final transcription runs.
  onRecordingStop?: () => void;
  // Fires repeatedly during recording with the latest provisional transcript of
  // the audio-so-far. Each call supersedes the previous one.
  onPartialTranscript?: (text: string) => void;
  // Fires once on stop with the final transcript (may be empty — e.g. silence —
  // which the caller uses to clear any provisional text).
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
// worker. whisper is a batch model, so "streaming" here means re-transcribing a
// bounded rolling window of the recent audio on a fast interval (committing text
// as it scrolls out of the window), then one clean full pass on stop. Runs fully
// offline on the web and desktop hosts. Transcript placement is the caller's job
// (see `useEditorDictation`).
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
  // Guards against overlapping partial passes (the worker is single-threaded).
  const partialBusyRef = useRef(false);
  // Text already committed from windows that scrolled past the cap, and the
  // sample offset it covers. The live window is transcribed on top of these.
  const committedTextRef = useRef("");
  const committedSampleRef = useRef(0);
  // Latest provisional transcript, used as the final result if the final pass
  // comes back empty (e.g. the tail got clipped).
  const lastPartialRef = useRef("");
  const startedAtRef = useRef(0);

  const recordingSupported = useMemo(() => isRecordingSupported(), []);
  // Only offer dictation once the offline engine artifacts are confirmed present
  // (they're git-ignored and built on demand). Absent → hide the mic entirely
  // rather than let a click fail.
  const [engineAvailable, setEngineAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    isWhisperEngineAvailable().then((available) => {
      if (!cancelled) setEngineAvailable(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const isSupported = recordingSupported && engineAvailable;

  // Warm the engine (load wasm + model) as soon as dictation is available so the
  // first recording streams partials immediately instead of waiting ~seconds on
  // the model load. warmup() is idempotent — the worker loads the model once.
  useEffect(() => {
    if (!isSupported) return;
    getWhisperClient()
      .warmup()
      .catch(() => {});
  }, [isSupported]);

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

  // Final pass over the whole clip once recording stops — the clean, accurate
  // result that replaces the streamed approximation.
  const transcribe = useCallback(async (blob: Blob, session: number) => {
    const alive = () => mountedRef.current && sessionRef.current === session;
    if (alive()) setStatus("transcribing");
    try {
      const pcm = await decodeToPcm16k(blob);
      let finalText = "";
      if (pcm && pcm.length > 0) {
        finalText = (
          await getWhisperClient().transcribe(pcm, DICTATION_LANG)
        ).trim();
      }
      // Fall back to the last provisional result if the final pass came back
      // empty so a good partial isn't thrown away.
      if (!finalText) finalText = lastPartialRef.current.trim();
      if (alive()) optionsRef.current.onTranscript?.(finalText);
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
    committedTextRef.current = "";
    committedSampleRef.current = 0;
    lastPartialRef.current = "";
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

      // Transcribe a bounded rolling window of the recent audio and emit it (on
      // top of the committed prefix) as a provisional result. Skipped while a
      // prior pass runs or once recording has ended. Commits the window's text
      // and advances the offset once the window outgrows the cap, so passes stay
      // fast regardless of total clip length.
      const runPartial = async () => {
        if (partialBusyRef.current) return;
        if (sessionRef.current !== session) return;
        if (recorderRef.current?.state !== "recording") return;
        if (chunksRef.current.length === 0) return;
        partialBusyRef.current = true;
        try {
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          const pcm = await decodeToPcm16k(blob);
          if (!pcm || pcm.length === 0) return;
          const committedSample = Math.min(
            committedSampleRef.current,
            pcm.length,
          );
          // `slice` copies into its own buffer so transferring it to the worker
          // doesn't detach the decoded PCM.
          const windowPcm = pcm.slice(committedSample);
          if (windowPcm.length === 0) return;
          const windowText = (
            await getWhisperClient().transcribe(windowPcm, DICTATION_LANG)
          ).trim();
          const stillRecording =
            mountedRef.current &&
            sessionRef.current === session &&
            recorderRef.current?.state === "recording";
          if (!stillRecording) return;
          const combined = joinText(committedTextRef.current, windowText);
          if (combined) {
            lastPartialRef.current = combined;
            optionsRef.current.onPartialTranscript?.(combined);
          }
          // Window outgrew the cap: commit its text and start a fresh window so
          // the next pass stays cheap.
          if (
            windowText &&
            windowPcm.length > STREAM_WINDOW_SEC * WHISPER_SAMPLE_RATE
          ) {
            committedTextRef.current = combined;
            committedSampleRef.current = pcm.length;
          }
        } catch {
          // Ignore partial failures; the next tick or the final pass recovers.
        } finally {
          partialBusyRef.current = false;
        }
      };

      recorder.start(STREAM_CHUNK_MS);
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setStatus("recording");
      optionsRef.current.onRecordingStart?.();
      timerRef.current = window.setInterval(() => {
        if (Date.now() - startedAtRef.current >= MAX_DICTATION_MS) {
          stop();
          return;
        }
        void runPartial();
      }, STREAM_INTERVAL_MS);
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
  // unmounted component. Reset `mountedRef` in the setup too: React StrictMode
  // (dev) mounts → unmounts → remounts, and without this the first cleanup would
  // leave the ref false forever, so every start() would bail after getUserMedia.
  useEffect(() => {
    mountedRef.current = true;
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

// Join a committed prefix and a window transcript into one string without double
// spaces or leading/trailing whitespace.
function joinText(committed: string, window: string): string {
  return [committed, window]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
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
