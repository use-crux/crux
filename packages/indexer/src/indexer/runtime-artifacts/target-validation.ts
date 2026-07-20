import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { RuntimeArtifactManifestTarget } from "@use-crux/core/runtime";
import ts from "typescript";
import {
  RuntimeArtifactGenerationError,
  runtimeArtifactFindingFromError,
} from "./findings";
import type { RuntimeArtifactFinding } from "./types";

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
  const findings = (
    await Promise.all(
      [...byFile].map(async ([file, exports]) => {
        const sourcePath = relative(root, file).replace(/\\/g, "/");
        let source: string;
        try {
          source = await readFile(file, "utf8");
        } catch (error) {
          return [
            runtimeArtifactFindingFromError(error, {
              code: "RUNTIME_TARGET_SOURCE_UNREADABLE",
              category: "environment",
              featureKind: "target",
              featureId: [...exports].sort(compareCodepoint)[0],
              source: sourcePath,
              summary: `Crux could not read Runtime target source '${sourcePath}'.`,
              whatStillWorks:
                "Other readable Runtime target files are unchanged.",
            }),
          ];
        }
        const namedExports = namedValueExports(file, source);
        return [...exports].flatMap((exportName) =>
          namedExports.has(exportName)
            ? []
            : [targetNotExportedFinding(sourcePath, exportName)],
        );
      }),
    )
  ).flat();
  if (findings.length > 0) {
    throw new RuntimeArtifactGenerationError(findings);
  }
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

function targetNotExportedFinding(
  source: string,
  exportName: string,
): RuntimeArtifactFinding {
  return {
    code: "TARGET_NOT_EXPORTED",
    category: "authored",
    featureKind: "target",
    featureId: exportName,
    source,
    summary: `Runtime target '${exportName}' is not exported from '${source}'.`,
    reason:
      "Runtime targets need a named export so generated host code can import the intended value.",
    whatStillWorks:
      "Other runtime targets with named exports can still be generated.",
    remediation: `Export it as \`export const ${exportName} = ...\` and save the file.`,
  };
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
