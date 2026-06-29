import type { AcpMessage } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import {
  sessionUpdateMessage,
  toolCallStartUpdate,
  toolResultUpdate,
} from "../chat/acpEnvelope";
import { createRevisionEditDetector } from "./useFollowSpecEdits";

// Wire format the runner reports: "<serverId>__<tool>".
const SPEC_UPDATE = "posthog__agent-applications-revisions-spec-update";
const AGENT_MD = "posthog__agent-applications-revisions-agent-md-update";
const PROMOTE = "posthog__agent-applications-revisions-promote-create";
const VALIDATE = "posthog__agent-applications-revisions-validate-create"; // read-ish
const RETRIEVE = "posthog__agent-applications-revisions-retrieve"; // read

function start(id: string, name: string): AcpMessage {
  return sessionUpdateMessage(
    toolCallStartUpdate(id, name, {}, "in_progress"),
    0,
  );
}
function done(id: string): AcpMessage {
  return sessionUpdateMessage(toolResultUpdate(id, "ok", false), 0);
}

describe("createRevisionEditDetector", () => {
  it("fires once when a revision-writing call completes after the baseline", () => {
    const d = createRevisionEditDetector();
    expect(d.scan([])).toBe(0); // baseline
    expect(d.scan([start("c1", SPEC_UPDATE)])).toBe(0); // in-flight, no result yet
    expect(d.scan([start("c1", SPEC_UPDATE), done("c1")])).toBe(1); // completed
    // Idempotent: rescanning the same transcript doesn't re-fire.
    expect(d.scan([start("c1", SPEC_UPDATE), done("c1")])).toBe(0);
  });

  it("reacts to the whole write family, not just spec-update", () => {
    const d = createRevisionEditDetector();
    d.scan([]);
    expect(d.scan([start("c1", AGENT_MD), done("c1")])).toBe(1);
    expect(
      d.scan([
        start("c1", AGENT_MD),
        done("c1"),
        start("c2", PROMOTE),
        done("c2"),
      ]),
    ).toBe(1);
  });

  it("ignores reads and validate (non-mutating tools)", () => {
    const d = createRevisionEditDetector();
    d.scan([]);
    expect(d.scan([start("c1", RETRIEVE), done("c1")])).toBe(0);
    expect(d.scan([start("c2", VALIDATE), done("c2")])).toBe(0);
    expect(d.scan([start("c3", "posthog__insight-query"), done("c3")])).toBe(0);
  });

  it("ignores calls already present at the baseline (resumed history)", () => {
    const d = createRevisionEditDetector();
    // Both the start and its completion are backlog → never fires.
    d.scan([start("c1", SPEC_UPDATE), done("c1")]);
    expect(d.scan([start("c1", SPEC_UPDATE), done("c1")])).toBe(0);
  });

  it("resets when the transcript shrinks (new chat)", () => {
    const d = createRevisionEditDetector();
    d.scan([]);
    expect(d.scan([start("c1", SPEC_UPDATE), done("c1")])).toBe(1); // c1 now acted
    d.scan([]); // newChat clears the transcript → state resets
    expect(d.scan([start("c1", SPEC_UPDATE), done("c1")])).toBe(1); // refires
  });
});
