// Loads the offline Vosk (Kaldi) streaming speech model. Unlike whisper, Vosk is
// a streaming-native recognizer: you feed it audio and it emits `partialresult`
// (the current words, updated as you speak) and `result` (a finalized phrase) —
// true word-by-word dictation, fully offline, on the web and desktop hosts.
//
// The model archive is git-ignored and downloaded on demand (see
// scripts/whisper-wasm/README or the package scripts), so the UI probes
// availability before offering the mic.

import { createModel, type Model } from "vosk-browser";

// ~128 MB "lgraph" English model — markedly more accurate than the 40 MB small
// model, still small enough to load in-browser. Served from the host's public
// dir. (Repackaged as .tar.gz from alphacephei's .zip; see the vosk download
// script.)
const VOSK_MODEL_URL = "/vosk/vosk-model-en-us-0.22-lgraph.tar.gz";

// Cheap check the UI uses to gate the mic button — a missing model archive means
// dictation isn't available in this build.
export async function isVoskEngineAvailable(): Promise<boolean> {
  try {
    const response = await fetch(VOSK_MODEL_URL, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

// The loaded model is shared across the app (it's large — one resident copy is
// plenty). Vosk runs its own Web Worker internally, so recognizers created from
// this model don't block the main thread.
let modelPromise: Promise<Model> | null = null;

export function getVoskModel(): Promise<Model> {
  if (!modelPromise) {
    modelPromise = createModel(VOSK_MODEL_URL).catch((error) => {
      // Allow a later retry if the load failed (e.g. transient network).
      modelPromise = null;
      throw error;
    });
  }
  return modelPromise;
}
