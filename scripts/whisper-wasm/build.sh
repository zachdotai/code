#!/usr/bin/env bash
set -euo pipefail

# Build the custom single-threaded whisper.wasm module used by offline voice
# dictation, and copy it into each host's public/whisper/ dir.
#
# Requires the Emscripten SDK (emcc / emcmake) on PATH — see README.md for
# installation. Produces libwhisper.mjs, a single-file ES module with the wasm
# embedded and our synchronous binding (binding.cpp).
#
# Env:
#   WHISPER_REF   whisper.cpp git ref to build (default below). Bump to a current
#                 release when updating.

WHISPER_REF="${WHISPER_REF:-v1.7.4}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORK_DIR="$SCRIPT_DIR/.build"
SRC_DIR="$WORK_DIR/whisper.cpp"

if ! command -v emcmake >/dev/null 2>&1; then
  echo "error: emcmake not found. Install and activate the Emscripten SDK first:" >&2
  echo "  https://emscripten.org/docs/getting_started/downloads.html" >&2
  echo "  (git clone https://github.com/emscripten-core/emsdk && ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh)" >&2
  exit 1
fi

mkdir -p "$WORK_DIR"
if [ ! -d "$SRC_DIR/.git" ]; then
  echo "Cloning whisper.cpp @ $WHISPER_REF ..."
  git clone --depth 1 --branch "$WHISPER_REF" \
    https://github.com/ggml-org/whisper.cpp "$SRC_DIR"
fi

# Drop in our synchronous binding and single-threaded CMake target, replacing the
# stock examples/whisper.wasm files.
cp "$SCRIPT_DIR/binding.cpp" "$SRC_DIR/examples/whisper.wasm/emscripten.cpp"
cp "$SCRIPT_DIR/CMakeLists.txt" "$SRC_DIR/examples/whisper.wasm/CMakeLists.txt"

echo "Configuring (emcmake) ..."
emcmake cmake -S "$SRC_DIR" -B "$WORK_DIR/build-em" \
  -DWHISPER_WASM_SINGLE_FILE=ON \
  -DCMAKE_BUILD_TYPE=Release

echo "Building libwhisper ..."
# Build only our target so unrelated examples (some don't build for wasm) don't
# fail the run.
cmake --build "$WORK_DIR/build-em" --target libwhisper -j

GLUE="$WORK_DIR/build-em/bin/libwhisper.js"
if [ ! -f "$GLUE" ]; then
  echo "error: build did not produce $GLUE" >&2
  echo "       check the build output above; the target may emit to a different dir." >&2
  exit 1
fi

for dest in \
  "$REPO_ROOT/apps/code/public/whisper" \
  "$REPO_ROOT/apps/web/public/whisper"; do
  mkdir -p "$dest"
  cp "$GLUE" "$dest/libwhisper.mjs"
  echo "wrote $dest/libwhisper.mjs"
done

echo ""
echo "WASM glue built. Next:"
echo "  1. node scripts/whisper-wasm/download-model.mjs   # fetch the model"
echo "  2. set SCAFFOLD_ALLOW_SHIM = false in"
echo "     packages/ui/src/features/message-editor/voice/whisperModule.ts"
