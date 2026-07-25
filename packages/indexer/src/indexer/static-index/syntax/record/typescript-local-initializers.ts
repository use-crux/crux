import ts from "typescript";
import type { StaticImportRecord, StaticInitializerRecord } from "./types";
import { sourceForNode, sourceSnippetForNode } from "../../../ast/snippets";
import { staticFunctionValueFromNode } from "./typescript-function-values";
import {
  oxcIndexedStatementScopes,
  type TypeScriptStatementScope,
} from "./typescript-initializer-scopes";
import { staticInitializerRecordsFromDeclaration } from "./typescript-values";

interface ScopedInitializerCandidate {
  readonly record: StaticInitializerRecord;
  readonly valueStart: number;
}

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
  const scopes: TypeScriptStatementScope[] = [];
  const indexedScopes = oxcIndexedStatementScopes(sourceFile);
  let current = node.parent;
  while (current) {
    if (
      (ts.isBlock(current) || ts.isSourceFile(current)) &&
      indexedScopes.has(current)
    ) {
      scopes.push(current);
    }
    current = current.parent;
  }
  const nodeStart = node.getStart(sourceFile);
  const seenNames = new Set<string>();
  const selected: ScopedInitializerCandidate[] = [];
  for (const scope of scopes) {
    const candidates = scopedVariableInitializerCandidates(
      sourceFile,
      scope,
      nodeStart,
      importsByLocalName,
    );
    candidates.sort(
      (left, right) =>
        right.valueStart - left.valueStart ||
        compareInitializerNames(right.record.name, left.record.name),
    );
    for (const candidate of candidates) {
      if (seenNames.has(candidate.record.name)) continue;
      seenNames.add(candidate.record.name);
      selected.push(candidate);
    }
  }
  selected.sort(
    (left, right) =>
      left.valueStart - right.valueStart ||
      compareInitializerNames(left.record.name, right.record.name),
  );
  return selected.map((candidate) => candidate.record);
}

function scopedVariableInitializerCandidates(
  sourceFile: ts.SourceFile,
  scope: TypeScriptStatementScope,
  matchStart: number,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): ScopedInitializerCandidate[] {
  const candidates: ScopedInitializerCandidate[] = [];
  for (const statement of variableStatementsInScope(scope.statements)) {
    for (const declaration of statement.declarationList.declarations) {
      const valueStart = (declaration.initializer ?? declaration).getStart(
        sourceFile,
      );
      if (valueStart >= matchStart) continue;
      for (const record of staticInitializerRecordsFromDeclaration(
        sourceFile,
        declaration,
        importsByLocalName,
      )) {
        candidates.push({ record, valueStart });
      }
    }
  }
  return candidates;
}

function variableStatementsInScope(
  statements: ts.NodeArray<ts.Statement>,
): readonly ts.VariableStatement[] {
  const variables: ts.VariableStatement[] = [];
  const visit = (statement: ts.Statement): void => {
    if (ts.isVariableStatement(statement)) {
      variables.push(statement);
      return;
    }
    if (!ts.isIfStatement(statement)) return;
    visit(statement.thenStatement);
    if (statement.elseStatement) visit(statement.elseStatement);
  };
  for (const statement of statements) visit(statement);
  return variables;
}

/** Compares Unicode scalar values in the same order as Rust UTF-8 strings. */
function compareInitializerNames(left: string, right: string): number {
  const leftCodePoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightCodePoints = Array.from(
    right,
    (value) => value.codePointAt(0) ?? 0,
  );
  const length = Math.min(leftCodePoints.length, rightCodePoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftCodePoints[index]! - rightCodePoints[index]!;
    if (difference !== 0) return difference;
  }
  return leftCodePoints.length - rightCodePoints.length;
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
