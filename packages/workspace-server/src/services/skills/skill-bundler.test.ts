import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleLocalSkill } from "./skill-bundler";

let root: string;
let skillPath: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "skill-bundler-test-"));
  skillPath = path.join(root, "alpha");
  await mkdir(skillPath, { recursive: true });
  await writeFile(path.join(skillPath, "SKILL.md"), "# alpha");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function bundledFileNames(): Promise<string[]> {
  const bundle = await bundleLocalSkill({
    name: "alpha",
    source: "user",
    skillPath,
  });
  const entries = unzipSync(Buffer.from(bundle.contentBase64, "base64"));
  return Object.keys(entries).sort();
}

async function writeManyFiles(dir: string, count: number): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Promise.all(
    Array.from({ length: count }, (_, i) =>
      writeFile(path.join(dir, `file-${i}.txt`), "x"),
    ),
  );
}

describe("bundleLocalSkill", () => {
  it("excludes hidden directories and junk but keeps hidden files and nested content", async () => {
    await mkdir(path.join(skillPath, ".venv", "lib"), { recursive: true });
    await writeFile(path.join(skillPath, ".venv", "lib", "site.py"), "x");
    await mkdir(path.join(skillPath, "node_modules", "pkg"), {
      recursive: true,
    });
    await writeFile(path.join(skillPath, "node_modules", "pkg", "i.js"), "x");
    await mkdir(path.join(skillPath, "references", "deep"), {
      recursive: true,
    });
    await writeFile(path.join(skillPath, "references", "deep", "x.md"), "xx");
    await writeFile(path.join(skillPath, ".gitignore"), "*.log");

    expect(await bundledFileNames()).toEqual([
      ".gitignore",
      "SKILL.md",
      "posthog-skill-bundle.json",
      "references/deep/x.md",
    ]);
  });

  it("does not count files inside hidden directories toward the file limit", async () => {
    await writeManyFiles(path.join(skillPath, ".venv"), 1100);

    expect(await bundledFileNames()).toEqual([
      "SKILL.md",
      "posthog-skill-bundle.json",
    ]);
  });

  it("names the skill and path when the file limit is exceeded", async () => {
    await writeManyFiles(path.join(skillPath, "data"), 1000);

    await expect(
      bundleLocalSkill({ name: "alpha", source: "user", skillPath }),
    ).rejects.toThrow(
      /Skill "alpha" \(.*alpha\) contains more than 1000 files/,
    );
  });
});
