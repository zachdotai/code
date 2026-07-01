// Custom Emscripten binding for whisper.cpp, tuned for offline dictation in the
// PostHog Code renderer. It replaces the stock examples/whisper.wasm binding
// (examples/whisper.wasm/emscripten.cpp) with two deliberate differences:
//
//   1. Synchronous, single-threaded. The stock binding runs whisper_full on a
//      std::thread (which requires pthreads → SharedArrayBuffer → cross-origin
//      isolation / COOP+COEP). We run it inline on the caller (the JS side runs
//      us inside a Web Worker, so the main thread stays responsive) and build
//      the WASM without pthreads, avoiding all the COOP/COEP plumbing.
//
//   2. Returns the transcript directly. The stock binding streams text through
//      stdout (Module.print) and never signals completion. We accumulate the
//      segment text and expose get_transcript(), so JS gets a clean string with
//      no stdout parsing and no "is it done yet?" guessing.
//
// The exported surface matches WhisperWasmModule in
// packages/ui/src/features/message-editor/voice/whisperTypes.ts. A single
// resident context is plenty for dictation; the index argument is kept only for
// interface parity with the stock example.
//
// NOTE: This has not been compiled in this environment (no Emscripten SDK). It
// targets the whisper.cpp C API and must be validated against the pinned
// whisper.cpp version on the first real build (see build.sh / README.md).

#include <emscripten/bind.h>
#include <string>
#include <vector>

#include "whisper.h"

using namespace emscripten;

namespace {
struct whisper_context *g_ctx = nullptr;
std::string g_transcript;
}  // namespace

// Load a model already written into the Emscripten FS. Returns 1 on success (a
// context handle) or 0 on failure, replacing any previously-loaded model.
int init(const std::string &path_model) {
  if (g_ctx != nullptr) {
    whisper_free(g_ctx);
    g_ctx = nullptr;
  }
  whisper_context_params cparams = whisper_context_default_params();
  g_ctx = whisper_init_from_file_with_params(path_model.c_str(), cparams);
  return g_ctx != nullptr ? 1 : 0;
}

// Transcribe 16 kHz mono Float32 audio synchronously. Returns 0 on success and
// leaves the concatenated text available via get_transcript(); negative values
// indicate no loaded model.
int full_default(int index, const val &audio, const std::string &lang,
                 int nthreads, bool translate) {
  (void)index;
  g_transcript.clear();
  if (g_ctx == nullptr) {
    return -1;
  }

  const std::vector<float> pcm = convertJSArrayToNumberVector<float>(audio);
  if (pcm.empty()) {
    return 0;
  }

  whisper_full_params params =
      whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
  params.print_realtime = false;
  params.print_progress = false;
  params.print_timestamps = false;
  params.print_special = false;
  params.translate = translate;
  // Safe because we run synchronously: `lang` outlives the whisper_full call.
  params.language = lang.c_str();
  params.n_threads = nthreads > 0 ? nthreads : 1;

  const int ret =
      whisper_full(g_ctx, params, pcm.data(), static_cast<int>(pcm.size()));
  if (ret == 0) {
    const int segments = whisper_full_n_segments(g_ctx);
    for (int i = 0; i < segments; i++) {
      const char *text = whisper_full_get_segment_text(g_ctx, i);
      if (text != nullptr) {
        g_transcript += text;
      }
    }
  }
  return ret;
}

// The concatenated text of the most recent full_default() call.
std::string get_transcript(int index) {
  (void)index;
  return g_transcript;
}

void free_ctx(int index) {
  (void)index;
  if (g_ctx != nullptr) {
    whisper_free(g_ctx);
    g_ctx = nullptr;
  }
}

EMSCRIPTEN_BINDINGS(whisper) {
  function("init", &init);
  function("full_default", &full_default);
  function("get_transcript", &get_transcript);
  function("free", &free_ctx);
}
