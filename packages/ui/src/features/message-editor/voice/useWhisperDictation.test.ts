import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./pcm", () => ({
  decodeToPcm16k: vi.fn(),
  WHISPER_SAMPLE_RATE: 16_000,
}));
vi.mock("./whisperClient", () => ({
  getWhisperClient: vi.fn(),
}));

import { decodeToPcm16k } from "./pcm";
import { useWhisperDictation } from "./useWhisperDictation";
import { getWhisperClient } from "./whisperClient";

// Minimal controllable MediaRecorder: the hook wires up ondataavailable/onstop,
// and stop() fires onstop synchronously so the transcription path runs.
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown) {
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
}

const transcribe =
  vi.fn<(pcm: Float32Array, lang: string) => Promise<string>>();
const warmup = vi.fn<() => Promise<void>>();
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  transcribe.mockResolvedValue("hello world");
  warmup.mockResolvedValue(undefined);
  vi.mocked(getWhisperClient).mockReturnValue({
    warmup,
    transcribe,
  } as unknown as ReturnType<typeof getWhisperClient>);
  vi.mocked(decodeToPcm16k).mockResolvedValue(new Float32Array([0.1]));

  getUserMedia = vi
    .fn()
    .mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useWhisperDictation", () => {
  it("runs idle → recording → transcribing → idle and emits the transcript", async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useWhisperDictation({ onTranscript }));

    expect(result.current.isSupported).toBe(true);
    expect(result.current.status).toBe("idle");

    await act(async () => {
      result.current.start();
    });
    await waitFor(() => expect(result.current.status).toBe("recording"));

    await act(async () => {
      result.current.stop();
    });
    await waitFor(() => expect(result.current.status).toBe("idle"));

    expect(transcribe).toHaveBeenCalledWith(expect.any(Float32Array), "en");
    expect(onTranscript).toHaveBeenCalledWith("hello world");
  });

  it("reports an error and stays idle when mic permission is denied", async () => {
    getUserMedia.mockRejectedValueOnce(
      new DOMException("denied", "NotAllowedError"),
    );
    const onError = vi.fn();
    const { result } = renderHook(() => useWhisperDictation({ onError }));

    await act(async () => {
      result.current.start();
    });

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError).toHaveBeenCalledWith(
      "Microphone access was blocked. Allow it in your system settings.",
    );
    expect(result.current.status).toBe("idle");
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("does not start a new recording while transcribing", async () => {
    // Hold the transcription open so we can observe the transcribing state.
    let release: (text: string) => void = () => {};
    transcribe.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useWhisperDictation());

    await act(async () => {
      result.current.start();
    });
    await waitFor(() => expect(result.current.status).toBe("recording"));
    await act(async () => {
      result.current.stop();
    });
    await waitFor(() => expect(result.current.status).toBe("transcribing"));

    // A toggle mid-transcription is a no-op — no second recorder is created.
    act(() => {
      result.current.toggle();
    });
    expect(FakeMediaRecorder.instances).toHaveLength(1);

    await act(async () => {
      release("done");
    });
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });
});
