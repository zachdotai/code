import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IDialog, PickFileOptions } from "@posthog/platform/dialog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpecImportService } from "./spec-import-service";

let workDir = "";

function makeDialog(filePaths: string[]): IDialog {
  return {
    confirm: vi.fn(),
    pickFile: vi.fn(async (_options: PickFileOptions) => filePaths),
  };
}

function writeSpec(name: string, content: string): string {
  const filePath = join(workDir, name);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

describe("SpecImportService", () => {
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "spec-import-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("returns null when the picker is dismissed", async () => {
    const service = new SpecImportService(makeDialog([]));
    expect(await service.importSpecFile()).toBeNull();
  });

  it("reads the file verbatim and derives name + definition of done", async () => {
    const content = [
      "# Argo EKS Upgrade",
      "",
      "Upgrade the cluster control plane and node groups.",
      "",
      "## Goals",
      "- Zero downtime",
      "",
      "## Definition of Done",
      "- Control plane on 1.30",
      "- All addons healthy",
      "",
      "### Verification",
      "kubectl get nodes shows Ready",
      "",
      "## Rollback",
      "Revert the node group.",
    ].join("\n");
    const filePath = writeSpec("argo-eks-upgrade-spec.md", content);
    const service = new SpecImportService(makeDialog([filePath]));

    const result = await service.importSpecFile();

    expect(result).not.toBeNull();
    expect(result?.fileName).toBe("argo-eks-upgrade-spec.md");
    expect(result?.filePath).toBe(filePath);
    // Body is kept intact, not re-drafted.
    expect(result?.content).toBe(content);
    expect(result?.suggestedName).toBe("Argo EKS Upgrade");
    // Captures the DoD section including its nested subsection, stopping at the
    // next same-level heading.
    expect(result?.definitionOfDone).toContain("Control plane on 1.30");
    expect(result?.definitionOfDone).toContain("All addons healthy");
    expect(result?.definitionOfDone).toContain("kubectl get nodes");
    expect(result?.definitionOfDone).not.toContain("Rollback");
  });

  it("falls back to the file name when there is no H1", async () => {
    const filePath = writeSpec("my-plan.md", "Just some prose, no heading.");
    const service = new SpecImportService(makeDialog([filePath]));

    const result = await service.importSpecFile();

    expect(result?.suggestedName).toBe("my-plan");
    expect(result?.definitionOfDone).toBeNull();
  });

  it("returns null DoD when no definition-of-done heading exists", async () => {
    const filePath = writeSpec("spec.md", "# Title\n\n## Scope\n- thing");
    const service = new SpecImportService(makeDialog([filePath]));

    const result = await service.importSpecFile();

    expect(result?.definitionOfDone).toBeNull();
  });

  it("matches a 'DoD' heading case-insensitively", async () => {
    const filePath = writeSpec(
      "spec.md",
      "# Title\n\n## dod\nShip it and verify.",
    );
    const service = new SpecImportService(makeDialog([filePath]));

    const result = await service.importSpecFile();

    expect(result?.definitionOfDone).toBe("Ship it and verify.");
  });

  it("finds 'definition of done' buried in a numbered, titled heading", async () => {
    const content = [
      "# Spec",
      "",
      "## 4. Acceptance Scenarios",
      "- not the done section",
      "",
      "## 14. Success Criteria (measurable — definition of done)",
      "- p95 latency under 200ms",
      "- error rate below 1%",
      "",
      "## 15. Out of Scope",
      "- everything else",
    ].join("\n");
    const filePath = writeSpec("spec.md", content);
    const service = new SpecImportService(makeDialog([filePath]));

    const result = await service.importSpecFile();

    // Prefers the heading that contains "definition of done" over the earlier
    // "Acceptance Scenarios" section.
    expect(result?.definitionOfDone).toContain("p95 latency under 200ms");
    expect(result?.definitionOfDone).toContain("error rate below 1%");
    expect(result?.definitionOfDone).not.toContain("not the done section");
    expect(result?.definitionOfDone).not.toContain("everything else");
  });

  it("falls back to a 'Success Criteria' heading when no explicit DoD exists", async () => {
    const content = [
      "# Spec",
      "",
      "## Success Criteria",
      "- ships behind a flag",
      "",
      "## Notes",
      "- later",
    ].join("\n");
    const filePath = writeSpec("spec.md", content);
    const service = new SpecImportService(makeDialog([filePath]));

    const result = await service.importSpecFile();

    expect(result?.definitionOfDone).toBe("- ships behind a flag");
  });

  it("preserves leading and trailing whitespace verbatim", async () => {
    const raw = "\n\n#  Indented spec\n\nbody line\n\n";
    const filePath = writeSpec("spec.md", raw);
    const service = new SpecImportService(makeDialog([filePath]));

    const result = await service.importSpecFile();

    expect(result?.content).toBe(raw);
  });

  it("rejects unsupported file types", async () => {
    const filePath = writeSpec("diagram.png", "not really a png");
    const service = new SpecImportService(makeDialog([filePath]));

    await expect(service.importSpecFile()).rejects.toThrow(/Unsupported/);
  });

  it("rejects an empty spec file", async () => {
    const filePath = writeSpec("empty.md", "   \n  \n");
    const service = new SpecImportService(makeDialog([filePath]));

    await expect(service.importSpecFile()).rejects.toThrow(/empty/i);
  });

  it("rejects a file over the size limit", async () => {
    const filePath = writeSpec("huge.md", "#".repeat(600 * 1024));
    const service = new SpecImportService(makeDialog([filePath]));

    await expect(service.importSpecFile()).rejects.toThrow(/too large/i);
  });

  it("truncates an over-long derived name to the schema limit", async () => {
    const longTitle = "A".repeat(200);
    const filePath = writeSpec("spec.md", `# ${longTitle}\n\nbody`);
    const service = new SpecImportService(makeDialog([filePath]));

    const result = await service.importSpecFile();

    expect(result?.suggestedName.length).toBeLessThanOrEqual(120);
  });
});
