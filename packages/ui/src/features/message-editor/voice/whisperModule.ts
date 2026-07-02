// Loads the offline whisper.wasm engine from the built artifacts under
// `/whisper/*` (produced by scripts/whisper-wasm; git-ignored, so absent until
// built). The worker calls loadWhisperEngine(); the UI calls
// isWhisperEngineAvailable() to decide whether to show the mic button at all, so
// environments without the artifacts hide dictation instead of erroring.

import type { WhisperEngine, WhisperWasmModule } from "./whisperTypes";

// Where the built artifacts will be served from once they exist. They are
// produced by building `examples/whisper.wasm` (single-file OFF, pthreads OFF,
// SIMD ON, EXPORT_ES6 + MODULARIZE, FS_createDataFile exported) plus the bundled
// quantized model. A leading-slash URL resolves against the app origin, which is
// correct for both the web host and the Electron renderer.
const WHISPER_GLUE_URL = "/whisper/libwhisper.mjs";
// tiny.en keeps the live streaming partials fast (see scripts/whisper-wasm).
const WHISPER_MODEL_URL = "/whisper/ggml-tiny.en-q5_1.bin";

// The model is written into the Emscripten FS under this fixed name (matching
// the stock example) before `init`.
const MODEL_FS_NAME = "whisper.bin";

// Single-threaded build: one thread, transcribe (never translate).
const NUM_THREADS = 1;

// The Emscripten module factory shape when built with EXPORT_ES6 + MODULARIZE.
type WhisperModuleFactory = (options: {
  locateFile?: (path: string) => string;
}) => Promise<WhisperWasmModule>;

// Cheap check the UI uses to gate the mic button. The artifacts are git-ignored
// and only present after `pnpm whisper:build && pnpm whisper:model`, so a missing
// glue file means dictation isn't available in this build — hide it rather than
// let the user click into an error.
export async function isWhisperEngineAvailable(): Promise<boolean> {
  try {
    const response = await fetch(WHISPER_GLUE_URL, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

// Load the whisper.wasm engine. The worker caches the returned promise, so this
// runs at most once per worker lifetime unless it rejects.
export async function loadWhisperEngine(): Promise<WhisperEngine> {
  // Vite treats /public files as non-module static assets and refuses to serve
  // them through import() (in the dev server and the build alike). Fetch the glue
  // as text and import it from a blob URL instead — that bypasses Vite's module
  // graph and works in dev and prod. The wasm is embedded via SINGLE_FILE, so the
  // module never fetches a sibling .wasm.
  const glueResponse = await fetch(WHISPER_GLUE_URL);
  if (!glueResponse.ok) {
    throw new Error(`Voice engine download failed (${glueResponse.status}).`);
  }
  const blobUrl = URL.createObjectURL(
    new Blob([await glueResponse.text()], { type: "text/javascript" }),
  );
  let module: WhisperWasmModule;
  try {
    const glue = (await import(/* @vite-ignore */ blobUrl)) as {
      default: WhisperModuleFactory;
    };
    module = await glue.default({
      locateFile: (path) => new URL(path, WHISPER_GLUE_URL).href,
    });
  } finally {
    URL.revokeObjectURL(blobUrl);
  }

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
