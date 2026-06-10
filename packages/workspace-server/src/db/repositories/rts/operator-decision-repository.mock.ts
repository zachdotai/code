import type {
  OperatorDecision,
  OperatorDecisionKind,
  RecordReviveHogletInput,
  RecordSuppressSignalReportInput,
} from "./operator-decision-repository";

export interface MockOperatorDecisionRepository {
  _decisions: OperatorDecision[];
  recordSuppressSignalReport(
    input: RecordSuppressSignalReportInput,
  ): OperatorDecision;
  recordReviveHoglet(input: RecordReviveHogletInput): OperatorDecision;
  listForNest(nestId: string): OperatorDecision[];
  findSuppressed(
    nestId: string,
    signalReportId: string,
  ): OperatorDecision | null;
  findRevived(nestId: string, hogletKey: string): OperatorDecision | null;
}

export function createMockOperatorDecisionRepository(): MockOperatorDecisionRepository {
  const decisions: OperatorDecision[] = [];

  const findBySubject = (
    nestId: string,
    kind: OperatorDecisionKind,
    subjectKey: string,
  ): OperatorDecision | null => {
    const found = decisions.find(
      (d) =>
        d.nestId === nestId && d.kind === kind && d.subjectKey === subjectKey,
    );
    return found ? { ...found } : null;
  };

  const upsert = (
    nestId: string,
    kind: OperatorDecisionKind,
    subjectKey: string,
    reason: string | null,
  ): OperatorDecision => {
    const idx = decisions.findIndex(
      (d) =>
        d.nestId === nestId && d.kind === kind && d.subjectKey === subjectKey,
    );
    if (idx >= 0) {
      const updatedAt = new Date().toISOString();
      const next: OperatorDecision = { ...decisions[idx], reason, updatedAt };
      decisions[idx] = next;
      return { ...next };
    }
    const now = new Date().toISOString();
    const row: OperatorDecision = {
      id: crypto.randomUUID(),
      nestId,
      kind,
      subjectKey,
      reason,
      createdAt: now,
      updatedAt: now,
    };
    decisions.push(row);
    return { ...row };
  };

  return {
    _decisions: decisions,
    recordSuppressSignalReport: (input) =>
      upsert(
        input.nestId,
        "suppress_signal_report",
        input.signalReportId,
        input.reason ?? null,
      ),
    recordReviveHoglet: (input) =>
      upsert(
        input.nestId,
        "revive_hoglet",
        input.subjectKey,
        input.reason ?? null,
      ),
    listForNest: (nestId) =>
      decisions
        .filter((d) => d.nestId === nestId)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        .map((d) => ({ ...d })),
    findSuppressed: (nestId, signalReportId) =>
      findBySubject(nestId, "suppress_signal_report", signalReportId),
    findRevived: (nestId, hogletKey) =>
      findBySubject(nestId, "revive_hoglet", hogletKey),
  };
}
