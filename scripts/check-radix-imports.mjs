#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST = join(ROOT, "scripts", "radix-allowlist.json");
const SCAN_ROOTS = ["packages", "apps"];

const ALLOWED_THEMES_IMPORTS = new Set(["Box", "Flex", "Text"]);

const USAGE = `check-radix-imports — freeze Radix UI usage; new UI comes from @posthog/quill.

  node scripts/check-radix-imports.mjs           verify: fail on any Radix import not in the allowlist
  node scripts/check-radix-imports.mjs --init     (re)generate the baseline allowlist from current imports
  node scripts/check-radix-imports.mjs --prune     drop allowlist entries no longer imported (after migrating)

Only Box, Flex, and Text from @radix-ui/themes are permitted in new code. Every
other Radix component and every other @radix-ui/* package is frozen: existing
imports are baselined in scripts/radix-allowlist.json and must not grow. The
allowlist size is the migration debt. Goal: 0.`;

// Matches static imports, re-exports, and dynamic imports of Radix packages.
const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?([\w$]+|\*\s+as\s+[\w$]+|\{[^}]*\}|[\w$]+\s*,\s*\{[^}]*\}|\*)?\s*(?:from\s*)?["'](@radix-ui\/[^"']+|radix-ui(?:\/[^"']*)?)["']/g;
const DYNAMIC_RE =
  /import\s*\(\s*["'](@radix-ui\/[^"']+|radix-ui(?:\/[^"']*)?)["']\s*\)/g;

function listFiles() {
  const globs = SCAN_ROOTS.flatMap((r) => [
    `"${r}/**/*.ts"`,
    `"${r}/**/*.tsx"`,
  ]);
  const out = execSync(`git -C "${ROOT}" ls-files ${globs.join(" ")}`, {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => !f.endsWith(".d.ts") && !f.includes("/generated"));
}

function importedNames(clause) {
  if (!clause) return ["*"]; // bare `import "pkg"` — side-effect import
  const names = [];
  const braces = clause.match(/\{([^}]*)\}/);
  if (braces) {
    for (let n of braces[1].split(",")) {
      n = n.trim().replace(/^type\s+/, "");
      if (!n) continue;
      names.push(n.split(/\s+as\s+/)[0].trim());
    }
  }
  const outsideBraces = clause
    .replace(/\{[^}]*\}/, "")
    .trim()
    .replace(/,$/, "")
    .trim();
  if (outsideBraces) names.push("*"); // default, namespace, or star import — all names reachable
  return names.length ? names : ["*"];
}

function violationsInSource(src) {
  const hits = new Set();
  IMPORT_RE.lastIndex = 0;
  for (let m = IMPORT_RE.exec(src); m; m = IMPORT_RE.exec(src)) {
    const [, clause, spec] = m;
    if (spec === "@radix-ui/themes") {
      for (const name of importedNames(clause)) {
        if (!ALLOWED_THEMES_IMPORTS.has(name)) hits.add(`${spec}#${name}`);
      }
    } else {
      hits.add(spec);
    }
  }
  DYNAMIC_RE.lastIndex = 0;
  for (let m = DYNAMIC_RE.exec(src); m; m = DYNAMIC_RE.exec(src)) {
    hits.add(m[1] === "@radix-ui/themes" ? `${m[1]}#*` : m[1]);
  }
  return [...hits].sort();
}

function findViolations() {
  const violations = {};
  for (const path of listFiles()) {
    let src;
    try {
      src = readFileSync(join(ROOT, path), "utf8");
    } catch {
      continue;
    }
    if (!src.includes("radix-ui")) continue;
    const hits = violationsInSource(src);
    if (hits.length) violations[path] = hits;
  }
  return violations;
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST)) return {};
  return JSON.parse(readFileSync(ALLOWLIST, "utf8")).files ?? {};
}

function saveAllowlist(files) {
  const sorted = Object.fromEntries(
    Object.keys(files)
      .sort()
      .map((k) => [k, files[k]]),
  );
  writeFileSync(
    ALLOWLIST,
    `${JSON.stringify({ note: "Radix imports frozen at baseline. Only Box/Flex/Text from @radix-ui/themes are allowed in new code; use @posthog/quill instead. Remove entries as you migrate. Goal: empty.", files: sorted }, null, 2)}\n`,
  );
  try {
    execSync(`pnpm exec biome format --write "${ALLOWLIST}"`, {
      cwd: ROOT,
      stdio: "ignore",
    });
  } catch {
    // biome unavailable (e.g. before pnpm install) — commit hooks/CI will format
  }
}

const mode = process.argv[2];
if (mode === "--help" || mode === "-h") {
  console.log(USAGE);
  process.exit(0);
}

const current = findViolations();
const allow = loadAllowlist();

if (mode === "--init") {
  saveAllowlist(current);
  console.log(
    `Baseline written: ${Object.keys(current).length} file(s) with frozen Radix imports.`,
  );
  process.exit(0);
}

if (mode === "--prune") {
  const kept = {};
  for (const f of Object.keys(allow)) {
    if (!current[f]) continue;
    kept[f] = allow[f].filter((e) => current[f].includes(e));
    if (!kept[f].length) delete kept[f];
  }
  const before = Object.values(allow).flat().length;
  const after = Object.values(kept).flat().length;
  saveAllowlist(kept);
  console.log(
    `Pruned. ${before - after} import(s) migrated, ${after} remaining.`,
  );
  process.exit(0);
}

const fresh = [];
for (const [file, entries] of Object.entries(current)) {
  const allowed = new Set(allow[file] ?? []);
  for (const e of entries) if (!allowed.has(e)) fresh.push({ file, entry: e });
}

const migrated = [];
for (const [file, entries] of Object.entries(allow)) {
  const now = new Set(current[file] ?? []);
  for (const e of entries) if (!now.has(e)) migrated.push({ file, entry: e });
}

if (migrated.length) {
  console.log(
    `\n✓ ${migrated.length} Radix import(s) migrated since baseline — run --prune to shrink the allowlist.`,
  );
}

if (fresh.length) {
  console.error(
    `\n✗ ${fresh.length} NEW Radix import(s) — Radix is frozen; new UI comes from @posthog/quill:\n`,
  );
  for (const { file, entry } of fresh) console.error(`  ${file}\n    ${entry}`);
  console.error(
    `\nOnly Box, Flex, and Text from @radix-ui/themes are allowed in new code. Use the
@posthog/quill equivalent (Button, Dialog*, Tooltip*, DropdownMenu*, ...) instead.
If you are only moving already-baselined code between files, update
scripts/radix-allowlist.json to match and justify it in review.`,
  );
  process.exit(1);
}

console.log(
  `\n✓ No new Radix imports. ${Object.values(allow).flat().length} frozen import(s) across ${Object.keys(allow).length} file(s) (baseline). Goal: 0.`,
);
process.exit(0);
