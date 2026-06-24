import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";
import type { BundleLocalSkillOutput, UploadableSkillSource } from "./schemas";

const SKILL_BUNDLE_MAX_BYTES = 30 * 1024 * 1024;
const SKILL_BUNDLE_MAX_FILES = 1000;
const IGNORED_ENTRIES = new Set([
  ".DS_Store",
  ".git",
  "node_modules",
  "__pycache__",
]);

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

async function collectSkillFiles(
  root: string,
  currentDir: string,
  files: Record<string, Uint8Array>,
): Promise<number> {
  const entries = await fs.promises.readdir(currentDir, {
    withFileTypes: true,
  });
  let totalBytes = 0;

  for (const entry of entries) {
    if (IGNORED_ENTRIES.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(root, absolutePath);
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
      if (!realPath || !isInsideRoot(root, realPath)) {
        continue;
      }
      const stat = await fs.promises.stat(realPath);
      if (!stat.isFile()) {
        continue;
      }
      const content = await fs.promises.readFile(realPath);
      files[toZipPath(relativePath)] = new Uint8Array(content);
      totalBytes += content.byteLength;
      continue;
    }

    if (entry.isDirectory()) {
      totalBytes += await collectSkillFiles(root, absolutePath, files);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const content = await fs.promises.readFile(absolutePath);
    files[toZipPath(relativePath)] = new Uint8Array(content);
    totalBytes += content.byteLength;
  }

  return totalBytes;
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
  const files: Record<string, Uint8Array> = {};
  const totalBytes = await collectSkillFiles(root, root, files);
  const fileNames = Object.keys(files).sort();

  if (!files["SKILL.md"]) {
    throw new Error("Local skill bundle must contain a SKILL.md file");
  }
  if (fileNames.length > SKILL_BUNDLE_MAX_FILES) {
    throw new Error(
      `Local skill bundle contains more than ${SKILL_BUNDLE_MAX_FILES} files`,
    );
  }
  if (totalBytes > SKILL_BUNDLE_MAX_BYTES) {
    throw new Error("Local skill bundle exceeds the 30MB cloud run limit");
  }

  const manifest = {
    schema_version: 1,
    name,
    source,
    bundled_at: new Date().toISOString(),
  };

  const zipInput: Record<string, Uint8Array> = {};
  for (const fileName of fileNames) {
    zipInput[fileName] = files[fileName];
  }
  zipInput["posthog-skill-bundle.json"] = strToU8(JSON.stringify(manifest));

  const zipped = zipSync(zipInput, { level: 6 });
  if (zipped.byteLength > SKILL_BUNDLE_MAX_BYTES) {
    throw new Error(
      "Local skill bundle archive exceeds the 30MB cloud run limit",
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
