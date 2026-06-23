import type { AgentRevision } from "@posthog/shared/agent-platform-types";
import { describe, expect, it } from "vitest";
import { findLatestDraft } from "./PublishButton";

function rev(overrides: Partial<AgentRevision>): AgentRevision {
  return {
    id: "r1",
    application: "app",
    parent_revision: null,
    state: "draft",
    bundle_sha256: null,
    created_by_id: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("findLatestDraft", () => {
  it("returns null when there are no revisions", () => {
    expect(findLatestDraft(undefined)).toBeNull();
    expect(findLatestDraft(null)).toBeNull();
    expect(findLatestDraft([])).toBeNull();
  });

  it("returns null when there are no draft revisions", () => {
    expect(
      findLatestDraft([rev({ state: "live" }), rev({ state: "archived" })]),
    ).toBeNull();
  });

  it("returns the newest draft by updated_at", () => {
    const drafts = [
      rev({ id: "old", state: "draft", updated_at: "2026-01-01T00:00:00Z" }),
      rev({ id: "new", state: "draft", updated_at: "2026-03-01T00:00:00Z" }),
      rev({ id: "mid", state: "draft", updated_at: "2026-02-01T00:00:00Z" }),
    ];
    expect(findLatestDraft(drafts)?.id).toBe("new");
  });

  it("ignores non-draft revisions even if newer", () => {
    const revisions = [
      rev({ id: "draft", state: "draft", updated_at: "2026-01-01T00:00:00Z" }),
      rev({ id: "live", state: "live", updated_at: "2026-06-01T00:00:00Z" }),
    ];
    expect(findLatestDraft(revisions)?.id).toBe("draft");
  });
});
