// Minimal typings and pure helpers for the browser Web Speech API
// (`SpeechRecognition`). The DOM lib doesn't ship these types, so we declare the
// slice we use. The API streams interim and final transcripts natively, which is
// exactly what voice dictation needs — no cloud round-trip and no extra
// dependency. Availability varies by host: it works in Chromium-based browsers
// (the web host); the desktop Electron build exposes the constructor but can
// return a "network" error at runtime because it ships without Google's speech
// backend. We surface that to the user rather than swallow it.

export interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternative | undefined;
}

export interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike | undefined;
}

export interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike {
  readonly error: string;
  readonly message: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((event: Event) => void) | null;
  onstart: ((event: Event) => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechWindow {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as SpeechWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export interface TranscriptDelta {
  // Text that just became final since the previous event; append permanently.
  final: string;
  // Best-guess text still being refined; show it, but expect it to be replaced.
  interim: string;
}

// Fold a `SpeechRecognition` result event into the newly-final text and the
// current interim tail. Only results from `resultIndex` onward are new — earlier
// ones were already delivered on prior events and never change again.
export function readTranscriptDelta(
  event: SpeechRecognitionEventLike,
): TranscriptDelta {
  let final = "";
  let interim = "";
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i];
    const alternative = result?.[0];
    if (!alternative) continue;
    if (result.isFinal) {
      final += alternative.transcript;
    } else {
      interim += alternative.transcript;
    }
  }
  return { final, interim };
}

// Map a `SpeechRecognition` error code to a user-facing message, or `null` when
// the error is benign (e.g. a silence timeout) and listening should just end
// quietly without a toast.
export function describeSpeechError(code: string): string | null {
  switch (code) {
    case "no-speech":
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was blocked. Allow it in your system settings.";
    case "audio-capture":
      return "No microphone was found. Check that one is connected.";
    case "network":
      return "Voice input needs a network connection and isn't available right now.";
    default:
      return "Voice input failed. Please try again.";
  }
}
