import { beforeEach, describe, expect, it } from "vitest";
import { useStaleConversationGateStore } from "./staleConversationGateStore";

const state = () => useStaleConversationGateStore.getState();
const engaged = (id: string) => state().engagedSessions.has(id);
const acknowledged = (id: string) => state().acknowledgedSessions.has(id);

describe("staleConversationGateStore", () => {
  beforeEach(() => {
    useStaleConversationGateStore.setState({
      engagedSessions: new Map(),
      acknowledgedSessions: new Set(),
    });
  });

  it("starts with nothing engaged or acknowledged", () => {
    expect(engaged("t1")).toBe(false);
    expect(acknowledged("t1")).toBe(false);
  });

  it("latches the last-activity snapshot from the first engage", () => {
    state().engage("t1", 1000);
    state().engage("t1", 2000);
    expect(state().engagedSessions.get("t1")).toBe(1000);
  });

  it("acknowledging releases the engagement and stays released", () => {
    state().engage("t1", 1000);
    state().acknowledge("t1");
    expect(engaged("t1")).toBe(false);
    expect(acknowledged("t1")).toBe(true);
    // Re-engaging after acknowledgement is a no-op for the app run.
    state().engage("t1", 2000);
    expect(engaged("t1")).toBe(false);
  });

  it("keeps other sessions untouched when one acknowledges", () => {
    state().engage("t1", 1000);
    state().engage("t2", 1000);
    state().acknowledge("t1");
    expect(engaged("t2")).toBe(true);
    expect(acknowledged("t2")).toBe(false);
  });

  it("is idempotent when acknowledging twice", () => {
    state().acknowledge("t1");
    const first = state().acknowledgedSessions;
    state().acknowledge("t1");
    expect(state().acknowledgedSessions).toBe(first);
  });
});
