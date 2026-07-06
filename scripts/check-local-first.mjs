#!/usr/bin/env node
/**
 * Local-first architecture gate: converted surfaces must not regress to
 * fetch-on-render patterns. Fails when a forbidden pattern appears outside
 * its allowlist. Run: node scripts/check-local-first.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/** Each rule: forbidden regex, directories it applies to, allowed files. */
const RULES = [
  {
    name: "polling on converted surfaces",
    pattern: /refetchInterval\s*:/,
    include: [
      "packages/ui/src/features/tasks",
      "packages/ui/src/features/sidebar",
      "packages/ui/src/features/canvas/hooks",
    ],
    // Bounded transient watch (canvas generation in flight), not a standing
    // poll — stops as soon as the folder has instructions.
    allow: ["packages/ui/src/features/canvas/hooks/useFolderGenerationTask.ts"],
    hint: "Converted surfaces read pools; freshness belongs to the sync engine (DeltaSource cadence or poke).",
  },
  {
    name: "task list query-cache surgery",
    pattern:
      /taskKeys\.lists\(\)|taskKeys\.list\(\)|taskKeys\.allSummaries\(\)/,
    include: ["packages/ui/src", "apps/code/src"],
    allow: ["packages/ui/src/features/tasks/taskKeys.ts"],
    hint: "Task lists/summaries live in the local-first pools — mutate via TaskMutationService, read via pool selectors.",
  },
  {
    name: "direct task list fetching in UI",
    pattern: /client\.getTasks\(/,
    include: ["packages/ui/src"],
    allow: [],
    hint: "Task list pulls belong to the DeltaSources in @posthog/core/tasks/taskSync.",
  },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      yield* walk(path);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield path;
    }
  }
}

let failures = 0;
for (const rule of RULES) {
  for (const dir of rule.include) {
    let files;
    try {
      files = [...walk(join(ROOT, dir))];
    } catch {
      continue;
    }
    for (const file of files) {
      const rel = relative(ROOT, file);
      if (rule.allow.includes(rel)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (rule.pattern.test(line)) {
          failures += 1;
          console.error(
            `✗ [${rule.name}] ${rel}:${i + 1}\n    ${line.trim()}\n    ${rule.hint}`,
          );
        }
      });
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} local-first violation(s).`);
  process.exit(1);
}
console.log("✓ local-first gate: no violations.");
