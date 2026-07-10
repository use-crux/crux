import ts from "typescript";
import type { StaticImportRecord, StaticInitializerRecord } from "./types";
import { sourceForNode, sourceSnippetForNode } from "../../../ast/snippets";
import { staticFunctionValueFromNode } from "./typescript-function-values";
import { staticInitializerRecordsFromDeclaration } from "./typescript-values";

type StatementAncestor = ts.Block | ts.SourceFile;

/** Collects source-level initializer evidence for the TypeScript syntax-record producer. */
export function collectLocalInitializers(
  sourceFile: ts.SourceFile,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): readonly StaticInitializerRecord[] {
  const records: StaticInitializerRecord[] = [];
  for (const statement of sourceFile.statements) {
    records.push(
      ...initializerRecordsFromStatement(
        sourceFile,
        statement,
        importsByLocalName,
      ),
    );
  }
  return records;
}

/** Collects initializer records visible before a match in its lexical block chain. */
export function scopedInitializerRecordsForNode(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): readonly StaticInitializerRecord[] {
  const records: StaticInitializerRecord[] = [];
  const ancestors: StatementAncestor[] = [];
  let current = node.parent;
  while (current) {
    if (ts.isBlock(current) || ts.isSourceFile(current))
      ancestors.unshift(current);
    current = current.parent;
  }
  const nodeStart = node.getStart(sourceFile);
  for (const ancestor of ancestors) {
    for (const statement of ancestor.statements) {
      if (statement.getStart(sourceFile) >= nodeStart) break;
      records.push(
        ...initializerRecordsFromStatement(
          sourceFile,
          statement,
          importsByLocalName,
        ),
      );
    }
  }
  return records;
}

function initializerRecordsFromStatement(
  sourceFile: ts.SourceFile,
  statement: ts.Statement,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): readonly StaticInitializerRecord[] {
  if (ts.isFunctionDeclaration(statement) && statement.name) {
    return [
      {
        name: statement.name.text,
        value: staticFunctionValueFromNode(
          sourceFile,
          statement,
          importsByLocalName,
        ),
        source: sourceForNode(sourceFile, statement),
        snippet: sourceSnippetForNode(sourceFile, statement),
      },
    ];
  }
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.flatMap((declaration) =>
    staticInitializerRecordsFromDeclaration(
      sourceFile,
      declaration,
      importsByLocalName,
    ),
  );
}
