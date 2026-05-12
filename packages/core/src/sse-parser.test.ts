import { describe, expect, it } from "vitest";
import { SseEventParser } from "./sse-parser.ts";

describe("SseEventParser", () => {
  it("parses a single data event", () => {
    const parser = new SseEventParser();
    const events = parser.parse('data: {"type":"connected"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toEqual({ type: "connected" });
  });

  it("parses multiple events in one chunk", () => {
    const parser = new SseEventParser();
    const events = parser.parse('data: {"a":1}\n\ndata: {"b":2}\n\n');
    expect(events).toHaveLength(2);
    expect(events[0].data).toEqual({ a: 1 });
    expect(events[1].data).toEqual({ b: 2 });
  });

  it("handles events split across chunks", () => {
    const parser = new SseEventParser();
    const first = parser.parse('data: {"type":"task');
    expect(first).toHaveLength(0);
    const second = parser.parse('_run_state"}\n\n');
    expect(second).toHaveLength(1);
    expect((second[0].data as Record<string, unknown>).type).toBe(
      "task_run_state",
    );
  });

  it("skips keepalive comment lines", () => {
    const parser = new SseEventParser();
    const events = parser.parse(': keepalive\n\ndata: {"type":"ok"}\n\n');
    expect(events).toHaveLength(1);
    expect((events[0].data as Record<string, unknown>).type).toBe("ok");
  });

  it("captures event name and id fields", () => {
    const parser = new SseEventParser();
    const events = parser.parse('event: myevent\nid: 42\ndata: {"x":1}\n\n');
    expect(events[0].event).toBe("myevent");
    expect(events[0].id).toBe("42");
  });

  it("skips events with unparseable JSON", () => {
    const parser = new SseEventParser();
    const events = parser.parse('data: not-json\n\ndata: {"ok":true}\n\n');
    expect(events).toHaveLength(1);
    expect((events[0].data as Record<string, unknown>).ok).toBe(true);
  });

  it("ignores empty events (no data lines)", () => {
    const parser = new SseEventParser();
    const events = parser.parse('\n\ndata: {"x":1}\n\n');
    expect(events).toHaveLength(1);
  });

  it("resets state correctly", () => {
    const parser = new SseEventParser();
    parser.parse('data: {"partial');
    parser.reset();
    const events = parser.parse('data: {"clean":true}\n\n');
    expect(events).toHaveLength(1);
    expect((events[0].data as Record<string, unknown>).clean).toBe(true);
  });

  it("handles \\r\\n line endings", () => {
    const parser = new SseEventParser();
    const events = parser.parse('data: {"type":"ok"}\r\n\r\n');
    expect(events).toHaveLength(1);
    expect((events[0].data as Record<string, unknown>).type).toBe("ok");
  });
});
