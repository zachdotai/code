# whisper.wasm — offline voice dictation artifacts

Voice dictation (the mic button in the prompt box) runs **whisper.cpp compiled to
WebAssembly**, entirely client-side, on both the web and desktop hosts — no
network, no cloud. This directory builds the two artifacts it needs:

| Artifact | What | Where it goes | Size |
| --- | --- | --- | --- |
| `libwhisper.mjs` | whisper.cpp compiled to a single-file ES module with our custom binding | `apps/{code,web}/public/whisper/` | ~2–3 MB |
| `ggml-base.en-q5_1.bin` | quantized English Whisper model | `apps/{code,web}/public/whisper/` | ~57 MB |

The renderer loads them at runtime (see
`packages/ui/src/features/message-editor/voice/whisperModule.ts`). Until both
exist, that module falls back to a **shim** (`SCAFFOLD_ALLOW_SHIM = true`) so the
capture → decode → worker → editor pipeline still runs during development.

## Design choices

- **Single-threaded.** No pthreads → no `SharedArrayBuffer` → no cross-origin
  isolation (COOP/COEP) needed in either host. Inference runs inside a Web Worker
  (`whisperEngine.worker.ts`) so the UI never blocks. If latency is unacceptable,
  the fallback is a multi-threaded build + COOP/COEP (out of scope here).
- **Custom synchronous binding** (`binding.cpp`). The stock `examples/whisper.wasm`
  streams text through stdout and runs on a worker thread; ours runs
  `whisper_full` inline and returns the transcript via `get_transcript()`. The
  exported surface matches `WhisperWasmModule` in `whisperTypes.ts`.
- **Single-file wasm** (`SINGLE_FILE=1`). One artifact, no sibling-`.wasm`
  `locateFile` juggling under Vite.
- **base.en-q5_1** (~57 MB) balances accuracy and size. For a smaller/faster
  option swap to `ggml-tiny.en-q5_1.bin` (~31 MB) in `download-model.mjs`.

## Build it

Prerequisite: the [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html).

```bash
git clone https://github.com/emscripten-core/emsdk
cd emsdk && ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh
cd -
```

Then, from the repo root:

```bash
pnpm whisper:build     # compile libwhisper.mjs → apps/{code,web}/public/whisper/
pnpm whisper:model     # download ggml-base.en-q5_1.bin → same dirs (~57 MB)
```

Finally flip the shim off in
`packages/ui/src/features/message-editor/voice/whisperModule.ts`:

```ts
const SCAFFOLD_ALLOW_SHIM = false;
```

## Verify

- Web: `pnpm --filter @posthog/web dev`, open the app, click the mic (or hold
  Space on an empty composer), speak, release — the transcript should insert.
  **Disconnect from the network first** to prove it's offline.
- Desktop: `pnpm dev`, same check.
  - ⚠️ **Packaging caveat to confirm on first desktop build:** the loader fetches
    `/whisper/*` (an absolute path). Whether that resolves in the *packaged*
    Electron renderer depends on how the renderer is served (custom protocol vs
    `file://`). If it doesn't resolve, switch `whisperModule.ts` to load the
    artifacts as Vite assets colocated in the package
    (`new URL("./assets/libwhisper.mjs?url", import.meta.url)` + `?url` for the
    model), which lets Vite emit correct per-host URLs. This is the one wiring
    decision that must be validated against a real packaged build.

## Files here

- `binding.cpp` — custom Emscripten binding (single-threaded, synchronous).
- `CMakeLists.txt` — overrides `examples/whisper.wasm/CMakeLists.txt` at build time.
- `build.sh` — clones a pinned whisper.cpp, drops in the two files above, builds.
- `download-model.mjs` — fetches the model with retry + a truncation check.

`.build/` (the whisper.cpp checkout + build tree) and the downloaded/built
artifacts under `apps/*/public/whisper/` are git-ignored.
