// Shared types for the offline whisper.cpp (WASM) dictation engine. The engine
// runs entirely client-side: audio is captured and decoded to 16 kHz mono PCM on
// the main thread, then transcribed by whisper.wasm inside a dedicated worker so
// the (blocking, single-threaded) inference never freezes the UI.

// The subset of the Emscripten-generated whisper.wasm module we call. It is
// produced by building `examples/whisper.wasm` with a small custom
// single-threaded synchronous binding (see the plan / build script): unlike the
// stock demo, `full_default` runs `whisper_full` inline (no pthread) and
// `get_transcript` returns the concatenated segment text, so we never parse
// stdout or guess when inference finished.
export interface WhisperWasmModule {
  // Load a model already written into the Emscripten FS; returns a context
  // handle (> 0) or 0 on failure.
  init(modelPath: string): number;
  // Transcribe 16 kHz mono Float32 audio synchronously; returns 0 on success.
  full_default(
    ctx: number,
    audio: Float32Array,
    lang: string,
    nthreads: number,
    translate: boolean,
  ): number;
  // Concatenated text of the most recent `full_default` run for this context.
  get_transcript(ctx: number): string;
  free(ctx: number): void;
  // Emscripten FS helpers (exported via EXPORTED_RUNTIME_METHODS) used to place
  // the model bytes into the virtual filesystem before `init`.
  FS_createDataFile(
    parent: string,
    name: string,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
  ): void;
}

// A loaded, ready-to-use transcriber. Wraps the raw wasm module (or the dev
// shim) so the worker has one uniform call surface.
export interface WhisperEngine {
  // Synchronously transcribe 16 kHz mono PCM into text.
  transcribe(pcm: Float32Array, lang: string): string;
  dispose(): void;
}

// Worker protocol. Every request carries an `id` the client correlates its
// pending promise against.
export type WhisperRequest =
  | { type: "warmup"; id: number }
  | { type: "transcribe"; id: number; pcm: Float32Array; lang: string };

export type WhisperResponse =
  | { type: "ready"; id: number }
  | { type: "result"; id: number; text: string }
  | { type: "error"; id: number; message: string };
