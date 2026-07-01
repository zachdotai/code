// Dedicated worker that owns the whisper.wasm engine. Transcription is a
// blocking, single-threaded call, so running it here keeps the main thread (and
// the editor) responsive. The engine is loaded lazily on the first message and
// reused for the worker's lifetime; a load failure clears the cache so the next
// request can retry.

import { loadWhisperEngine } from "./whisperModule";
import type {
  WhisperEngine,
  WhisperRequest,
  WhisperResponse,
} from "./whisperTypes";

// Typed view of the worker global that avoids depending on the "webworker" lib
// (the package typechecks under the DOM lib shared with the rest of the UI).
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<WhisperRequest>) => void) | null;
  postMessage: (message: WhisperResponse) => void;
};

let enginePromise: Promise<WhisperEngine> | null = null;

function getEngine(): Promise<WhisperEngine> {
  if (!enginePromise) enginePromise = loadWhisperEngine();
  return enginePromise;
}

function fail(id: number, error: unknown): void {
  // Drop the cached engine so a transient failure (e.g. model still
  // downloading) doesn't wedge every later request.
  enginePromise = null;
  ctx.postMessage({
    type: "error",
    id,
    message:
      error instanceof Error ? error.message : "Voice transcription failed.",
  });
}

ctx.onmessage = async (event) => {
  const request = event.data;
  try {
    const engine = await getEngine();
    if (request.type === "warmup") {
      ctx.postMessage({ type: "ready", id: request.id });
      return;
    }
    const text = engine.transcribe(request.pcm, request.lang);
    ctx.postMessage({ type: "result", id: request.id, text });
  } catch (error) {
    fail(request.id, error);
  }
};
