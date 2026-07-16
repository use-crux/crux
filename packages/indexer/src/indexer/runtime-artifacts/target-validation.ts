import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeArtifactManifestTarget } from "@use-crux/core/runtime";
import { createRuntimeError } from "@use-crux/core/runtime";
import ts from "typescript";

/** Verify that every discovered durable target remains a named value export. */
export async function validateTargetExports(
  root: string,
  targets: readonly RuntimeArtifactManifestTarget[],
): Promise<void> {
  const byFile = new Map<string, Set<string>>();
  for (const target of targets) {
    const file = join(root, target.module.replace(/^\.\//, ""));
    const exports = byFile.get(file) ?? new Set<string>();
    exports.add(target.export);
    byFile.set(file, exports);
  }
  await Promise.all(
    [...byFile].map(async ([file, exports]) => {
      const source = await readFile(file, "utf8");
      const namedExports = namedValueExports(file, source);
      for (const exportName of exports) {
        if (!namedExports.has(exportName)) {
          throw targetNotExportedError(file, exportName);
        }
      }
    }),
  );
}

function namedValueExports(file: string, source: string): Set<string> {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const exports = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (hasExportModifier(statement)) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            exports.add(declaration.name.text);
          }
        }
      } else if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement)) &&
        statement.name
      ) {
        exports.add(statement.name.text);
      }
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        exports.add(element.name.text);
      }
    }
  }
  return exports;
}

function hasExportModifier(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

function targetNotExportedError(file: string, exportName: string): never {
  throw createRuntimeError({
    code: "TARGET_NOT_EXPORTED",
    whatFailed: `Runtime target export \`${exportName}\` was not found in \`${file}\`.`,
    why: "Generated runtime entries import targets by named export, and default or local-only targets cannot be wired durably.",
    whatStillWorks:
      "Other runtime targets with named exports can still be generated.",
    nextStep: `Export the target as \`export const ${exportName} = ...\`, then run \`crux runtime generate\` again.`,
  });
}
