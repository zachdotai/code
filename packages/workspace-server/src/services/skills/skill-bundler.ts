import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";
import type { BundleLocalSkillOutput, UploadableSkillSource } from "./schemas";
import { isIgnoredSkillEntry } from "./skill-discovery";

const SKILL_BUNDLE_MAX_BYTES = 30 * 1024 * 1024;
const SKILL_BUNDLE_MAX_FILES = 1000;

function toZipPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function getSafeSkillFileName(name: string): string {
  const safeName = path.basename(name).replace(/[^\w.-]/g, "_");
  return safeName.length > 0 ? safeName : "skill";
}

async function assertSkillRoot(skillPath: string): Promise<string> {
  const root = await fs.promises.realpath(path.resolve(skillPath));
  const skillMdPath = path.join(root, "SKILL.md");
  const stat = await fs.promises.stat(skillMdPath);
  if (!stat.isFile()) {
    throw new Error("Local skill bundle must contain a SKILL.md file");
  }
  return root;
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    Boolean(relative) &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

interface SkillFileAccumulator {
  skillName: string;
  root: string;
  files: Record<string, Uint8Array>;
  totalBytes: number;
}

async function addSkillFile(
  acc: SkillFileAccumulator,
  relativePath: string,
  sourcePath: string,
  size: number,
): Promise<void> {
  if (Object.keys(acc.files).length >= SKILL_BUNDLE_MAX_FILES) {
    throw new Error(
      `Skill "${acc.skillName}" (${acc.root}) contains more than ` +
        `${SKILL_BUNDLE_MAX_FILES} files. Cloud runs upload every file in ` +
        `the skill folder, so move data and build artifacts out of it.`,
    );
  }
  if (acc.totalBytes + size > SKILL_BUNDLE_MAX_BYTES) {
    throw new Error(
      `Skill "${acc.skillName}" (${acc.root}) exceeds the 30MB cloud run upload limit`,
    );
  }
  const content = await fs.promises.readFile(sourcePath);
  acc.files[toZipPath(relativePath)] = new Uint8Array(content);
  acc.totalBytes += content.byteLength;
}

async function collectSkillFiles(
  currentDir: string,
  acc: SkillFileAccumulator,
): Promise<void> {
  const entries = await fs.promises.readdir(currentDir, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    if (isIgnoredSkillEntry(entry)) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(acc.root, absolutePath);
    if (
      !relativePath ||
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath)
    ) {
      continue;
    }

    if (entry.isSymbolicLink()) {
      const realPath = await fs.promises
        .realpath(absolutePath)
        .catch(() => null);
      if (!realPath || !isInsideRoot(acc.root, realPath)) {
        continue;
      }
      const stat = await fs.promises.stat(realPath);
      if (!stat.isFile()) {
        continue;
      }
      await addSkillFile(acc, relativePath, realPath, stat.size);
      continue;
    }

    if (entry.isDirectory()) {
      await collectSkillFiles(absolutePath, acc);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const stat = await fs.promises.stat(absolutePath);
    await addSkillFile(acc, relativePath, absolutePath, stat.size);
  }
}

export async function bundleLocalSkill({
  name,
  source,
  skillPath,
}: {
  name: string;
  source: UploadableSkillSource;
  skillPath: string;
}): Promise<BundleLocalSkillOutput> {
  const root = await assertSkillRoot(skillPath);
  const acc: SkillFileAccumulator = {
    skillName: name,
    root,
    files: {},
    totalBytes: 0,
  };
  await collectSkillFiles(root, acc);
  const files = acc.files;
  const fileNames = Object.keys(files).sort();

  if (!files["SKILL.md"]) {
    throw new Error("Local skill bundle must contain a SKILL.md file");
  }

  const manifest = {
    schema_version: 1,
    name,
    source,
  };

  const zipInput: Record<string, Uint8Array> = {};
  for (const fileName of fileNames) {
    zipInput[fileName] = files[fileName];
  }
  zipInput["posthog-skill-bundle.json"] = strToU8(JSON.stringify(manifest));

  const zipped = zipSync(zipInput, { level: 6 });
  if (zipped.byteLength > SKILL_BUNDLE_MAX_BYTES) {
    throw new Error(
      `Skill "${name}" (${root}) zip archive exceeds the 30MB cloud run upload limit`,
    );
  }

  const contentSha256 = crypto
    .createHash("sha256")
    .update(zipped)
    .digest("hex");

  return {
    name,
    source,
    fileName: `${getSafeSkillFileName(name)}.zip`,
    contentType: "application/zip",
    contentBase64: Buffer.from(zipped).toString("base64"),
    contentSha256,
    size: zipped.byteLength,
  };
}
