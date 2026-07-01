import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@posthog/ui/utils/customSound", () => ({
  decodeAudioClip: vi.fn(),
}));

import { decodeAudioClip } from "@posthog/ui/utils/customSound";
import { decodeToPcm16k, WHISPER_SAMPLE_RATE } from "./pcm";

const mockedDecode = vi.mocked(decodeAudioClip);

describe("decodeToPcm16k", () => {
  beforeEach(() => {
    mockedDecode.mockReset();
  });

  it("returns null when the clip can't be decoded", async () => {
    mockedDecode.mockResolvedValue(null);
    expect(await decodeToPcm16k(new Blob())).toBeNull();
  });

  it("returns a copy of the mono channel when already 16 kHz mono", async () => {
    const samples = new Float32Array([0.1, -0.2, 0.3]);
    const buffer = {
      sampleRate: WHISPER_SAMPLE_RATE,
      numberOfChannels: 1,
      duration: samples.length / WHISPER_SAMPLE_RATE,
      getChannelData: () => samples,
    } as unknown as AudioBuffer;
    mockedDecode.mockResolvedValue(buffer);

    const pcm = await decodeToPcm16k(new Blob());

    expect(pcm && Array.from(pcm)).toEqual(Array.from(samples));
    // A distinct buffer, safe to transfer to the worker without clobbering the
    // decoded source.
    expect(pcm).not.toBe(samples);
  });
});
