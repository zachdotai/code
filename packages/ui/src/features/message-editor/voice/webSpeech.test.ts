import { describe, expect, it } from "vitest";
import {
  describeSpeechError,
  readTranscriptDelta,
  type SpeechRecognitionEventLike,
} from "./webSpeech";

// Build a fake SpeechRecognition result event from a list of [transcript,
// isFinal] pairs, mirroring the array-like shape the browser hands us.
function makeEvent(
  resultIndex: number,
  results: Array<[string, boolean]>,
): SpeechRecognitionEventLike {
  const list = results.map(([transcript, isFinal]) => ({
    isFinal,
    length: 1,
    0: { transcript, confidence: 1 },
  }));
  return {
    resultIndex,
    results: Object.assign(list, { length: list.length }),
  } as unknown as SpeechRecognitionEventLike;
}

describe("readTranscriptDelta", () => {
  it("returns interim text while a phrase is still forming", () => {
    const delta = readTranscriptDelta(makeEvent(0, [["hello wor", false]]));
    expect(delta).toEqual({ final: "", interim: "hello wor" });
  });

  it("promotes a finalized phrase to the final field", () => {
    const delta = readTranscriptDelta(makeEvent(0, [["Hello world.", true]]));
    expect(delta).toEqual({ final: "Hello world.", interim: "" });
  });

  it("only reads results from resultIndex onward", () => {
    // Index 0 was delivered on an earlier event; only index 1 is new.
    const delta = readTranscriptDelta(
      makeEvent(1, [
        ["Hello.", true],
        [" and now", false],
      ]),
    );
    expect(delta).toEqual({ final: "", interim: " and now" });
  });

  it("concatenates a newly-final phrase and a trailing interim", () => {
    const delta = readTranscriptDelta(
      makeEvent(0, [
        ["First.", true],
        [" second", false],
      ]),
    );
    expect(delta).toEqual({ final: "First.", interim: " second" });
  });

  it("ignores results with no alternatives", () => {
    const event = {
      resultIndex: 0,
      results: Object.assign([{ isFinal: false, length: 0 }], { length: 1 }),
    } as unknown as SpeechRecognitionEventLike;
    expect(readTranscriptDelta(event)).toEqual({ final: "", interim: "" });
  });
});

describe("describeSpeechError", () => {
  it("treats benign codes as no message", () => {
    expect(describeSpeechError("no-speech")).toBeNull();
    expect(describeSpeechError("aborted")).toBeNull();
  });

  it("maps permission codes to a settings hint", () => {
    expect(describeSpeechError("not-allowed")).toMatch(/Microphone access/);
    expect(describeSpeechError("service-not-allowed")).toMatch(
      /Microphone access/,
    );
  });

  it("explains the network limitation", () => {
    expect(describeSpeechError("network")).toMatch(/network connection/);
  });

  it("falls back to a generic message for unknown codes", () => {
    expect(describeSpeechError("something-new")).toMatch(/try again/i);
  });
});
