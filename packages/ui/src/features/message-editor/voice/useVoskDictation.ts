import { isRecordingSupported } from "@posthog/ui/utils/customSound";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KaldiRecognizer } from "vosk-browser";
import { getVoskModel, isVoskEngineAvailable } from "./voskEngine";

// Recording is capped so a forgotten open mic doesn't run forever.
const MAX_DICTATION_MS = 120_000;
// After stop we flush the recognizer; give its final `result` event a moment to
// land before finalizing the text.
const FINALIZE_DELAY_MS = 350;

export type VoskStatus = "idle" | "recording";

export interface UseVoskDictationOptions {
  onRecordingStart?: () => void;
  onRecordingStop?: () => void;
  // Fires on every recognizer update with the full transcript so far (committed
  // phrases + the in-progress partial) — this is the word-by-word stream.
  onPartialTranscript?: (text: string) => void;
  // Fires once on stop with the final transcript.
  onTranscript?: (text: string) => void;
  onError?: (message: string) => void;
}

export interface UseVoskDictation {
  status: VoskStatus;
  isSupported: boolean;
  isRecording: boolean;
  // Always false — Vosk streams in realtime, so there's no separate final pass.
  isTranscribing: boolean;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

// Loose shape of the recognizer event messages (the package's discriminated
// types aren't re-exported), covering `result`, `partialresult`, and `error`.
type VoskMessage = {
  result?: { text?: string; partial?: string };
  error?: string;
};

// Offline word-by-word voice dictation driven by Vosk (Kaldi). Streams mic audio
// straight into a streaming recognizer that emits partial words as you speak and
// finalizes phrases on silence — no batch inference, no final-pass wait. Runs
// fully offline on both hosts. Transcript placement is the caller's job (see
// `useEditorDictation`).
export function useVoskDictation(
  options: UseVoskDictationOptions = {},
): UseVoskDictation {
  const [status, setStatus] = useState<VoskStatus>("idle");

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const recognizerRef = useRef<KaldiRecognizer | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const sinkRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  // Bumped every start(); recognizer events and the finalize timer check it and
  // bail if a newer session began or the component unmounted.
  const sessionRef = useRef(0);
  // Accumulated finalized phrases, and the current in-progress partial.
  const committedRef = useRef("");
  const partialRef = useRef("");

  const recordingSupported = useMemo(() => isRecordingSupported(), []);
  // Only offer dictation once the model archive is confirmed present (it's
  // git-ignored and downloaded on demand). Absent → hide the mic entirely.
  const [engineAvailable, setEngineAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    isVoskEngineAvailable().then((available) => {
      if (!cancelled) setEngineAvailable(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const isSupported = recordingSupported && engineAvailable;

  // Preload the model as soon as dictation is available so the first recording
  // starts instantly. getVoskModel() caches — the model loads once.
  useEffect(() => {
    if (!isSupported) return;
    getVoskModel().catch(() => {});
  }, [isSupported]);

  const stopAudio = useCallback(() => {
    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    if (nodeRef.current) nodeRef.current.onaudioprocess = null;
    try {
      nodeRef.current?.disconnect();
    } catch {}
    try {
      sinkRef.current?.disconnect();
    } catch {}
    try {
      sourceRef.current?.disconnect();
    } catch {}
    nodeRef.current = null;
    sinkRef.current = null;
    sourceRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    const recognizer = recognizerRef.current;
    const ctx = audioCtxRef.current;
    if (!recognizer) return;
    recognizerRef.current = null;
    audioCtxRef.current = null;
    stopAudio();
    optionsRef.current.onRecordingStop?.();
    setStatus("idle");
    // Flush the last partial into a final result, wait briefly for it to land,
    // then finalize and tear the recognizer down.
    try {
      recognizer.retrieveFinalResult();
    } catch {}
    window.setTimeout(() => {
      if (mountedRef.current && sessionRef.current === session) {
        optionsRef.current.onTranscript?.(
          joinText(committedRef.current, partialRef.current),
        );
      }
      try {
        recognizer.remove();
      } catch {}
      ctx?.close().catch(() => {});
    }, FINALIZE_DELAY_MS);
  }, [stopAudio]);

  const start = useCallback(async () => {
    if (recognizerRef.current) return;
    const session = ++sessionRef.current;
    committedRef.current = "";
    partialRef.current = "";
    getVoskModel().catch(() => {});
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const model = await getVoskModel();
      // A newer session started (or we unmounted) while awaiting the mic/model.
      if (!mountedRef.current || sessionRef.current !== session) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;

      const ctx = new AudioContext();
      const recognizer = new model.KaldiRecognizer(ctx.sampleRate);
      recognizer.setWords(true);

      const emitPartial = () => {
        if (sessionRef.current !== session) return;
        optionsRef.current.onPartialTranscript?.(
          joinText(committedRef.current, partialRef.current),
        );
      };
      recognizer.on("result", (message) => {
        if (sessionRef.current !== session) return;
        const text = (message as VoskMessage).result?.text?.trim();
        if (text) {
          committedRef.current = joinText(committedRef.current, text);
          partialRef.current = "";
          emitPartial();
        }
      });
      recognizer.on("partialresult", (message) => {
        if (sessionRef.current !== session) return;
        partialRef.current =
          (message as VoskMessage).result?.partial?.trim() ?? "";
        emitPartial();
      });
      recognizer.on("error", (message) => {
        if (sessionRef.current !== session) return;
        optionsRef.current.onError?.(
          (message as VoskMessage).error || "Voice transcription failed.",
        );
      });

      const node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (event) => {
        try {
          recognizerRef.current?.acceptWaveform(event.inputBuffer);
        } catch {}
      };
      const source = ctx.createMediaStreamSource(stream);
      // A ScriptProcessor only runs while connected to the destination; route it
      // through a muted gain so the mic isn't played back.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);

      recognizerRef.current = recognizer;
      audioCtxRef.current = ctx;
      nodeRef.current = node;
      sinkRef.current = sink;
      sourceRef.current = source;
      setStatus("recording");
      optionsRef.current.onRecordingStart?.();
      maxTimerRef.current = window.setTimeout(() => stop(), MAX_DICTATION_MS);
    } catch (error) {
      stopAudio();
      if (mountedRef.current && sessionRef.current === session) {
        optionsRef.current.onError?.(micErrorMessage(error));
      }
    }
  }, [stop, stopAudio]);

  const toggle = useCallback(() => {
    if (recognizerRef.current) stop();
    else void start();
  }, [start, stop]);

  // Tear down any in-flight capture on unmount. Reset `mountedRef` in the setup
  // too, so React StrictMode's mount→unmount→remount doesn't leave it false.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current++;
      stopAudio();
      try {
        recognizerRef.current?.remove();
      } catch {}
      recognizerRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, [stopAudio]);

  return {
    status,
    isSupported,
    isRecording: status === "recording",
    isTranscribing: false,
    start: () => void start(),
    stop,
    toggle,
  };
}

// Join a committed prefix and the current partial without double spaces.
function joinText(committed: string, partial: string): string {
  return [committed, partial]
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
