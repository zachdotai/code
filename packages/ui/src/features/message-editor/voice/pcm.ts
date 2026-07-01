// Decode a recorded audio clip into the exact shape whisper.cpp expects: a
// single channel of 16 kHz Float32 PCM. This runs on the main thread because the
// Web Audio API (OfflineAudioContext / decodeAudioData) is not available inside
// workers — the resulting Float32Array is then transferred to the whisper worker
// for inference.

import { decodeAudioClip } from "@posthog/ui/utils/customSound";

// whisper.cpp is trained on 16 kHz audio and resamples internally if given
// anything else; feeding it 16 kHz directly avoids a needless conversion.
export const WHISPER_SAMPLE_RATE = 16_000;

// Decode `blob` (a MediaRecorder capture — Opus-in-WebM on Chromium) to 16 kHz
// mono Float32 PCM, or null when it can't be decoded (exotic container / no Web
// Audio support). Reuses the shared decoder, then resamples + downmixes via an
// OfflineAudioContext rendered at the target rate.
export async function decodeToPcm16k(blob: Blob): Promise<Float32Array | null> {
  const decoded = await decodeAudioClip(blob);
  if (!decoded) return null;
  return resampleToMono16k(decoded);
}

// Render an arbitrary-rate, arbitrary-channel buffer down to a mono 16 kHz
// Float32Array. Connecting a multi-channel source to a mono destination lets Web
// Audio downmix per the standard mixing rules, and rendering into a 16 kHz
// context resamples in one pass.
async function resampleToMono16k(buffer: AudioBuffer): Promise<Float32Array> {
  if (
    buffer.sampleRate === WHISPER_SAMPLE_RATE &&
    buffer.numberOfChannels === 1
  ) {
    return buffer.getChannelData(0).slice();
  }
  const frameCount = Math.max(
    1,
    Math.ceil(buffer.duration * WHISPER_SAMPLE_RATE),
  );
  const offline = new OfflineAudioContext(1, frameCount, WHISPER_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  // Copy out of the rendered buffer so the returned array owns its ArrayBuffer
  // and can be transferred to the worker without cloning.
  return rendered.getChannelData(0).slice();
}
