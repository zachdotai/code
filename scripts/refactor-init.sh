#!/usr/bin/env bash
#
# refactor-init.sh — baseline check for a fresh refactor agent.
#
# Run this at the start of every refactor session (REFACTOR.md "Agent Startup
# Protocol" step 5). It installs deps, builds the package graph, and typechecks
# so you can confirm the baseline is green BEFORE piling a new migration slice
# on top of an unknown failure.
#
# It deliberately does NOT launch the Electron app — the app smoke test is
# manual and per-slice (see REFACTOR.md "Validation"). This script prints the
# commands for that at the end.
#
# Usage:
#   bash scripts/refactor-init.sh                 # full baseline (install, build deps, typecheck)
#   SKIP_INSTALL=1 bash scripts/refactor-init.sh  # skip pnpm install (deps already current)
#   WITH_TESTS=1   bash scripts/refactor-init.sh  # also run the unit test suites
#   FAST=1         bash scripts/refactor-init.sh  # skip install AND build deps (typecheck only)

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
step() { printf "\n\033[1;36m==> %s\033[0m\n" "$1"; }
ok()   { printf "\033[1;32m✓ %s\033[0m\n" "$1"; }
warn() { printf "\033[1;33m! %s\033[0m\n" "$1"; }

SKIP_INSTALL="${SKIP_INSTALL:-0}"
WITH_TESTS="${WITH_TESTS:-0}"
FAST="${FAST:-0}"
if [ "$FAST" = "1" ]; then
  SKIP_INSTALL=1
fi

step "Context"
bold "pwd: $ROOT"
if command -v node >/dev/null 2>&1; then bold "node: $(node -v)"; fi
if command -v pnpm >/dev/null 2>&1; then bold "pnpm: $(pnpm -v)"; else warn "pnpm not found — run 'corepack enable' or install pnpm"; fi
bold "branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"

step "Recent history (git log --oneline -10)"
git log --oneline -10 || true

step "Worktree status (git status --short)"
if [ -n "$(git status --short)" ]; then
  git status --short
else
  ok "clean"
fi

step "Coordination files"
for f in REFACTOR.md MIGRATION.md REFACTOR_PROGRESS.md REFACTOR_SLICES.json AGENTS.md; do
  if [ -f "$f" ]; then ok "$f present"; else warn "$f MISSING"; fi
done

if [ -f REFACTOR_SLICES.json ] && command -v node >/dev/null 2>&1; then
  step "Slice summary (REFACTOR_SLICES.json)"
  node -e '
    const j = require("./REFACTOR_SLICES.json");
    const s = j.slices || [];
    const by = {};
    for (const x of s) by[x.status] = (by[x.status] || 0) + 1;
    console.log("total slices:", s.length);
    for (const k of Object.keys(by).sort()) console.log("  " + k + ": " + by[k]);
    const inprog = s.filter(x => x.status === "in_progress");
    if (inprog.length) {
      console.log("\nin_progress (claimed — do not take these):");
      for (const x of inprog) console.log("  - " + x.id + " (claimedBy: " + (x.claimedBy || "?") + ")");
    }
    const todo = s.filter(x => x.status === "todo").sort((a, b) => b.priority - a.priority).slice(0, 5);
    console.log("\ntop unclaimed todo by priority:");
    for (const x of todo) console.log("  - [" + x.priority + "] " + x.id + " (" + x.category + ")");
  '
fi

if [ "$SKIP_INSTALL" != "1" ]; then
  step "Install dependencies (pnpm install)"
  pnpm install
  ok "dependencies installed"
else
  warn "skipping pnpm install (SKIP_INSTALL=1)"
fi

if [ "$FAST" != "1" ]; then
  step "Build package graph (pnpm build:deps)"
  pnpm build:deps
  ok "package deps built"
else
  warn "skipping build:deps (FAST=1)"
fi

step "Typecheck (pnpm typecheck)"
pnpm typecheck
ok "typecheck passed"

if [ "$WITH_TESTS" = "1" ]; then
  step "Unit tests (pnpm test)"
  pnpm test
  ok "tests passed"
else
  warn "skipping tests (set WITH_TESTS=1 to run 'pnpm test')"
fi

step "Baseline OK"
cat <<'EOF'
Next steps:
  1. Read REFACTOR.md, MIGRATION.md, REFACTOR_PROGRESS.md, REFACTOR_SLICES.json.
  2. Claim ONE todo slice: set status -> in_progress and claimedBy -> your id.
  3. Verify the app actually runs before changing code (manual smoke test):
       pnpm dev          # both workspace-server (agent) + code app
       # or just the desktop app:
       pnpm dev:code
  4. Work the slice per REFACTOR.md "Per-Feature Procedure".
  5. Finish per REFACTOR.md "Agent Finish Protocol": focused tests, real smoke
     test, update REFACTOR_SLICES.json + REFACTOR_PROGRESS.md + MIGRATION.md.
  6. Before committing: pnpm biome format --write . && pnpm typecheck
     (Biome formats REFACTOR_SLICES.json too; commit the formatted version.)

Do NOT set passes:true until acceptance checks AND a real smoke test pass.
EOF
