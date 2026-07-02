#!/usr/bin/env bash
set -euo pipefail

# Fetch the offline Vosk (Kaldi) speech model used for word-by-word dictation and
# place it in each host's public/vosk/ dir. The model is git-ignored, so run this
# once on a fresh checkout:
#
#   pnpm install && pnpm vosk:model
#
# Vosk loads a `.tar.gz` with the model directory at the archive root; alphacephei
# publishes `.zip`, so this downloads the zip and repackages it.
#
# Env:
#   VOSK_MODEL  model name to fetch (default below). The small model
#               (vosk-model-small-en-us-0.15, ~40MB) is faster but much less
#               accurate; the default lgraph model (~124MB) is the accuracy sweet
#               spot that still loads in-browser.

MODEL="${VOSK_MODEL:-vosk-model-en-us-0.22-lgraph}"
URL="https://alphacephei.com/vosk/models/${MODEL}.zip"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORK_DIR="$SCRIPT_DIR/.build"
DESTS=(
  "$REPO_ROOT/apps/code/public/vosk"
  "$REPO_ROOT/apps/web/public/vosk"
)

# Skip if the archive is already in every destination.
missing=false
for dest in "${DESTS[@]}"; do
  [ -f "$dest/${MODEL}.tar.gz" ] || missing=true
done
if [ "$missing" = false ]; then
  echo "Vosk model ${MODEL} already present — nothing to do."
  exit 0
fi

if ! command -v unzip >/dev/null 2>&1; then
  echo "error: 'unzip' is required to unpack the Vosk model." >&2
  exit 1
fi

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

echo "Downloading ${MODEL} (~124MB) ..."
curl -fL "$URL" -o model.zip

echo "Unpacking + repackaging as .tar.gz ..."
rm -rf "$MODEL"
unzip -q model.zip
tar czf "${MODEL}.tar.gz" "$MODEL"

for dest in "${DESTS[@]}"; do
  mkdir -p "$dest"
  cp "${MODEL}.tar.gz" "$dest/"
  echo "wrote $dest/${MODEL}.tar.gz"
done

cd "$REPO_ROOT"
rm -rf "$WORK_DIR"
echo "Done. If the app is running, reload it to pick up the model."
