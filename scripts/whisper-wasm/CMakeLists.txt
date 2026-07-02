# Custom whisper.wasm build target for PostHog Code offline dictation. This
# replaces the stock examples/whisper.wasm/CMakeLists.txt at build time (see
# build.sh). Differences from stock:
#   - single-threaded: no -s USE_PTHREADS, so no SharedArrayBuffer and no
#     COOP/COEP cross-origin isolation is required in the host.
#   - ES6 module + MODULARIZE: dynamic-importable from our Web Worker.
#   - SINGLE_FILE: the wasm is embedded in the .js, so there's one artifact to
#     ship and no sibling-.wasm locateFile juggling under a bundler.
#   - FS_createDataFile exported: the worker writes the model into the FS.
#
# The output is bin/libwhisper.js (an ES module exporting `createWhisperModule`).

set(TARGET libwhisper)

add_executable(${TARGET} emscripten.cpp)

# embind (emscripten/bind.h) requires C++17 or newer; without this the target
# compiles at the toolchain default and fails with "embind requires -std=c++17".
target_compile_features(${TARGET} PRIVATE cxx_std_17)

include(DefaultTargetOptions)

target_link_libraries(${TARGET} PRIVATE whisper)

# DefaultTargetOptions already enables WASM SIMD (-msimd128) for the emscripten
# toolchain; here we only set the link/emcc output options. Note the absence of
# USE_PTHREADS — this is the single-threaded build.
set_target_properties(${TARGET} PROPERTIES LINK_FLAGS
    "--bind \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s EXPORT_NAME=createWhisperModule \
    -s SINGLE_FILE=1 \
    -s ENVIRONMENT=web,worker \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=256MB \
    -s MAXIMUM_MEMORY=2000MB \
    -s FORCE_FILESYSTEM=1 \
    -s EXPORTED_RUNTIME_METHODS=['FS_createDataFile'] \
    ")
