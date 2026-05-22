import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDatabase } from "../../test-helpers";
import {
  type OperatorDecision,
  OperatorDecisionRepository,
} from "./operator-decision-repository";

class StubDatabaseService {
  constructor(public readonly db: TestDatabase["db"]) {}
}

describe("OperatorDecisionRepository", () => {
  let testDb: TestDatabase;
  let repo: OperatorDecisionRepository;
  const nestId = "nest-1";

  beforeEach(() => {
    testDb = createTestDb();
    testDb.db.run(
      `INSERT INTO rts_nest (id, name, goal_prompt, map_x, map_y) VALUES ('${nestId}', 'fixture', 'goal', 0, 0)`,
    );
    repo = new OperatorDecisionRepository(
      new StubDatabaseService(testDb.db) as never,
    );
  });

  afterEach(() => {
    testDb.close();
  });

  it("records a suppress_signal_report decision", () => {
    const row = repo.recordSuppressSignalReport({
      nestId,
      signalReportId: "signal-1",
      reason: "operator dismissed",
    });
    expect(row.kind).toBe("suppress_signal_report");
    expect(row.subjectKey).toBe("signal-1");
    expect(row.reason).toBe("operator dismissed");
  });

  it("records a revive_hoglet decision", () => {
    const row = repo.recordReviveHoglet({
      nestId,
      subjectKey: "hoglet-7",
    });
    expect(row.kind).toBe("revive_hoglet");
    expect(row.subjectKey).toBe("hoglet-7");
    expect(row.reason).toBeNull();
  });

  it("upserts on duplicate (nestId, kind, subjectKey)", () => {
    const first = repo.recordSuppressSignalReport({
      nestId,
      signalReportId: "signal-2",
      reason: "first",
    });
    const second = repo.recordSuppressSignalReport({
      nestId,
      signalReportId: "signal-2",
      reason: "second",
    });
    expect(second.id).toBe(first.id);
    expect(second.reason).toBe("second");
    expect(repo.listForNest(nestId)).toHaveLength(1);
  });

  it("findSuppressed returns the matching row", () => {
    repo.recordSuppressSignalReport({ nestId, signalReportId: "sig-a" });
    const found = repo.findSuppressed(nestId, "sig-a");
    expect(found).not.toBeNull();
    expect(found?.kind).toBe("suppress_signal_report");
    expect(repo.findSuppressed(nestId, "sig-missing")).toBeNull();
  });

  it("findRevived only matches revive_hoglet rows", () => {
    repo.recordSuppressSignalReport({ nestId, signalReportId: "sig-x" });
    repo.recordReviveHoglet({ nestId, subjectKey: "hog-x" });
    expect(repo.findRevived(nestId, "hog-x")).not.toBeNull();
    // A suppressed signal with the same key shouldn't show up as a revive.
    expect(repo.findRevived(nestId, "sig-x")).toBeNull();
  });

  it("isolates rows by nestId", () => {
    const otherNest = "nest-2";
    testDb.db.run(
      `INSERT INTO rts_nest (id, name, goal_prompt, map_x, map_y) VALUES ('${otherNest}', 'other', 'goal', 0, 0)`,
    );
    repo.recordReviveHoglet({ nestId, subjectKey: "hog-shared" });
    repo.recordReviveHoglet({ nestId: otherNest, subjectKey: "hog-shared" });
    expect(repo.listForNest(nestId)).toHaveLength(1);
    expect(repo.listForNest(otherNest)).toHaveLength(1);
  });

  it("listForNest returns decisions in creation order", () => {
    repo.recordReviveHoglet({ nestId, subjectKey: "hog-a" });
    repo.recordSuppressSignalReport({ nestId, signalReportId: "sig-b" });
    const rows: OperatorDecision[] = repo.listForNest(nestId);
    expect(rows.map((r) => r.subjectKey)).toEqual(["hog-a", "sig-b"]);
  });
});
