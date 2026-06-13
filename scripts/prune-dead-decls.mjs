// Temporary helper for the dead-code sweep. Deletes the declarations / re-export
// specifiers that knip flagged as unused, but only when ts-morph confirms zero
// remaining references inside the package. Operating on the original (still
// exported) source lets ts-morph see import-type and namespace references that
// knip misses, so genuine false positives are kept. Restricted to the flagged
// name set and a protected set of import-type members. Safe only on src-exporting
// packages where knip's cross-package detection is accurate. Delete when done.
import { readFileSync } from "node:fs";
import { Node, Project } from "ts-morph";

const pkgDir = process.argv[2];
const namesFile = process.argv[3];
const protectedFile = process.argv[4];
if (!pkgDir || !namesFile) {
  console.error("usage: node prune-dead-decls.mjs <pkgDir> <namesFile> [protectedFile]");
  process.exit(1);
}

const readSet = (f) =>
  f
    ? new Set(
        readFileSync(f, "utf8")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : new Set();

const names = readSet(namesFile);
const protectedNames = readSet(protectedFile);

const project = new Project({ tsConfigFilePath: `${pkgDir}/tsconfig.json` });

const inPkg = (sf) => {
  const fp = sf.getFilePath();
  return (
    fp.includes(`${pkgDir}/src/`) &&
    !fp.endsWith(".test.ts") &&
    !fp.endsWith(".test.tsx")
  );
};

const liveRefs = (nameNode) =>
  nameNode
    .findReferencesAsNodes()
    .filter(
      (r) =>
        !(
          r.getSourceFile() === nameNode.getSourceFile() &&
          r.getStart() === nameNode.getStart()
        ),
    );

const removedNames = [];
let changed = true;
let pass = 0;
while (changed && pass < 12) {
  changed = false;
  pass++;
  for (const sf of project.getSourceFiles()) {
    if (!inPkg(sf)) continue;
    for (const stmt of [...sf.getStatements()]) {
      // Re-export / named export clauses: export { a, b } [from "..."]
      if (Node.isExportDeclaration(stmt)) {
        const named = stmt.getNamedExports();
        if (named.length === 0) continue;
        for (const spec of [...named]) {
          const exportedName = spec.getName();
          if (!names.has(exportedName) || protectedNames.has(exportedName)) continue;
          const nameNode = spec.getAliasNode() ?? spec.getNameNode();
          if (liveRefs(nameNode).length === 0) {
            spec.remove();
            removedNames.push(exportedName);
            changed = true;
          }
        }
        if (
          stmt.wasForgotten() === false &&
          stmt.getNamedExports().length === 0 &&
          !stmt.getNamespaceExport()
        ) {
          stmt.remove();
          changed = true;
        }
        continue;
      }

      // Declarations
      let declNodes = [];
      if (Node.isVariableStatement(stmt)) declNodes = stmt.getDeclarations();
      else if (
        Node.isFunctionDeclaration(stmt) ||
        Node.isClassDeclaration(stmt) ||
        Node.isTypeAliasDeclaration(stmt) ||
        Node.isInterfaceDeclaration(stmt) ||
        Node.isEnumDeclaration(stmt)
      )
        declNodes = [stmt];
      else continue;

      const nameNodes = [];
      let eligible = declNodes.length > 0;
      for (const d of declNodes) {
        const nn = d.getNameNode?.();
        if (
          !nn ||
          !Node.isIdentifier(nn) ||
          !names.has(nn.getText()) ||
          protectedNames.has(nn.getText())
        ) {
          eligible = false;
          break;
        }
        nameNodes.push(nn);
      }
      if (!eligible) continue;

      if (nameNodes.flatMap(liveRefs).length === 0) {
        const removed = nameNodes.map((n) => n.getText());
        stmt.remove();
        removedNames.push(...removed);
        changed = true;
      }
    }
  }
}

for (const sf of project.getSourceFiles()) if (inPkg(sf)) sf.fixUnusedIdentifiers();
project.saveSync();
console.log(`pruned ${removedNames.length} in ${pkgDir}`);
