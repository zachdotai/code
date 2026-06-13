// Temporary helper for the dead-code sweep. Prints every symbol name imported
// from <scope> (e.g. @posthog/core) by packages/apps OTHER than <selfPkgDir>.
// Used as a protected set so the pruner never deletes a declaration that another
// package consumes through a re-export chain knip mis-attributed. Delete when done.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const scope = process.argv[2];
const selfPkgDir = process.argv[3];
if (!scope || !selfPkgDir) {
  console.error("usage: node external-usage.mjs <scope> <selfPkgDir>");
  process.exit(1);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const scopeRe = esc(scope);
const namedImport = new RegExp(
  `(?:import|export)\\s+(?:type\\s+)?(?:[\\w*]+\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*['"]${scopeRe}(?:/[^'"]*)?['"]`,
  "g",
);
const importType = new RegExp(
  `import\\(['"]${scopeRe}(?:/[^'"]*)?['"]\\)\\.([A-Za-z_$][\\w$]*)`,
  "g",
);

const files = execSync("git ls-files packages apps", { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith(`${selfPkgDir}/`));

const names = new Set();
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  let m;
  while ((m = namedImport.exec(text))) {
    for (let part of m[1].split(",")) {
      part = part.trim().replace(/^type\s+/, "");
      if (!part) continue;
      const name = part.split(/\s+as\s+/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  while ((m = importType.exec(text))) names.add(m[1]);
}

process.stdout.write(`${[...names].sort().join("\n")}\n`);
