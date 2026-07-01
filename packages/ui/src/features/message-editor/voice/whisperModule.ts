// The single seam where the real whisper.wasm artifacts get wired in. Everything
// else in the voice pipeline talks to the returned `WhisperEngine`, so swapping
// the dev shim for the built module is a change confined to this file.
//
// This runs inside the whisper worker.

import type { WhisperEngine, WhisperWasmModule } from "./whisperTypes";

// Where the built artifacts will be served from once they exist. They are
// produced by building `examples/whisper.wasm` (single-file OFF, pthreads OFF,
// SIMD ON, EXPORT_ES6 + MODULARIZE, FS_createDataFile exported) plus the bundled
// quantized model. A leading-slash URL resolves against the app origin, which is
// correct for both the web host and the Electron renderer.
const WHISPER_GLUE_URL = "/whisper/libwhisper.mjs";
const WHISPER_MODEL_URL = "/whisper/ggml-base.en-q5_1.bin";

// The model is written into the Emscripten FS under this fixed name (matching
// the stock example) before `init`.
const MODEL_FS_NAME = "whisper.bin";

// Single-threaded build: one thread, transcribe (never translate).
const NUM_THREADS = 1;

// SCAFFOLD: the real artifacts are not bundled yet (see the plan — the WASM
// build + model download land in a later phase). Until then, fall back to a shim
// so the full capture → decode → worker → insert pipeline is exercisable. Flip
// to `false` (or delete the shim path) once `/whisper/*` assets are shipped.
const SCAFFOLD_ALLOW_SHIM = true;

// The Emscripten module factory shape when built with EXPORT_ES6 + MODULARIZE.
type WhisperModuleFactory = (options: {
  locateFile?: (path: string) => string;
}) => Promise<WhisperWasmModule>;

// Load the real whisper.wasm engine, or (during scaffolding) a shim. The worker
// caches the returned promise, so this runs at most once per worker lifetime
// unless it rejects.
export async function loadWhisperEngine(): Promise<WhisperEngine> {
  try {
    return await loadWasmEngine();
  } catch (error) {
    if (SCAFFOLD_ALLOW_SHIM) {
      return createShimEngine();
    }
    throw error instanceof Error
      ? error
      : new Error("Failed to load the voice model.");
  }
}

async function loadWasmEngine(): Promise<WhisperEngine> {
  // `@vite-ignore` keeps the bundler from trying to resolve this URL at build
  // time — the artifact is fetched at runtime once it's shipped.
  const glue = (await import(/* @vite-ignore */ WHISPER_GLUE_URL)) as {
    default: WhisperModuleFactory;
  };
  const module = await glue.default({
    locateFile: (path) => new URL(path, WHISPER_GLUE_URL).href,
  });

  const response = await fetch(WHISPER_MODEL_URL);
  if (!response.ok) {
    throw new Error(`Voice model download failed (${response.status}).`);
  }
  const modelBytes = new Uint8Array(await response.arrayBuffer());
  module.FS_createDataFile("/", MODEL_FS_NAME, modelBytes, true, true);

  const ctx = module.init(MODEL_FS_NAME);
  if (!ctx) {
    throw new Error("Voice model failed to initialize.");
  }

  return {
    transcribe: (pcm, lang) => {
      const status = module.full_default(ctx, pcm, lang, NUM_THREADS, false);
      if (status !== 0) {
        throw new Error("Transcription failed.");
      }
      return module.get_transcript(ctx).trim();
    },
    dispose: () => module.free(ctx),
  };
}

// Stand-in engine used while the real artifacts are absent. It proves the
// end-to-end plumbing (mic → decode → worker → editor insert) without
// transcribing anything real.
function createShimEngine(): WhisperEngine {
  return {
    transcribe: () =>
      "[voice dictation preview — whisper.wasm model not bundled yet]",
    dispose: () => {},
  };
}
