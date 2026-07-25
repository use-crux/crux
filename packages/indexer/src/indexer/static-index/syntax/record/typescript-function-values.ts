import ts from "typescript";
import type {
  StaticFunctionCallValue,
  StaticFunctionParameterBinding,
  StaticImportRecord,
  StaticInitializerRecord,
  StaticSyntaxValue,
} from "./types";
import { sourceForNode, sourceSnippetForNode } from "../../../ast/snippets";
import {
  bindingEntries,
  bindingNames,
  staticInitializerRecordsFromDeclaration,
  staticSyntaxValueFromExpression,
} from "./typescript-values";
import { staticCalleeRecordFromExpression } from "./typescript-callee";
import {
  createStaticSyntaxInitializerMap,
  resolveStaticSyntaxValue,
} from "./value";

/** Converts a function-like TypeScript node into normalized function evidence. */
export function staticFunctionValueFromNode(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): StaticSyntaxValue {
  const parameterNames = staticFunctionParameterNames(node);
  const firstParameterBindings = staticFunctionFirstParameterBindings(node);
  return {
    kind: "function",
    ...(parameterNames.length > 0 ? { parameterNames } : {}),
    ...(firstParameterBindings.length > 0 ? { firstParameterBindings } : {}),
    calls: staticFunctionCallsFromNode(sourceFile, node, importsByLocalName),
    returns: staticFunctionReturnsFromNode(
      sourceFile,
      node,
      importsByLocalName,
    ),
    localInitializers: staticFunctionInitializersFromNode(
      sourceFile,
      node,
      importsByLocalName,
    ),
    source: sourceForNode(sourceFile, node),
    snippet: sourceSnippetForNode(sourceFile, node),
  };
}

function staticFunctionParameterNames(node: ts.Node): readonly string[] {
  if (!isFunctionLikeWithParameters(node)) return [];
  return node.parameters.flatMap((parameter) => bindingNames(parameter.name));
}

function staticFunctionFirstParameterBindings(
  node: ts.Node,
): readonly StaticFunctionParameterBinding[] {
  if (!isFunctionLikeWithParameters(node)) return [];
  const [first] = node.parameters;
  return first ? bindingEntries(first.name) : [];
}

function isFunctionLikeWithParameters(
  node: ts.Node,
): node is ts.FunctionLikeDeclaration {
  return (
    "parameters" in node &&
    Array.isArray((node as { parameters?: unknown }).parameters)
  );
}

function staticFunctionCallsFromNode(
  sourceFile: ts.SourceFile,
  root: ts.Node,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): readonly StaticFunctionCallValue[] {
  const calls: StaticFunctionCallValue[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      calls.push(
        staticFunctionCallFromExpression(sourceFile, node, importsByLocalName),
      );
      visit(node.expression);
      for (const argument of node.arguments) visit(argument);
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  return calls;
}

function staticFunctionReturnsFromNode(
  sourceFile: ts.SourceFile,
  root: ts.Node,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): readonly StaticSyntaxValue[] {
  const returns: StaticSyntaxValue[] = [];
  if (ts.isArrowFunction(root) && ts.isExpression(root.body)) {
    returns.push(
      staticFunctionReturnValue(sourceFile, root.body, importsByLocalName),
    );
  }
  const visit = (node: ts.Node): void => {
    if (isFunctionLikeNode(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      returns.push(
        staticFunctionReturnValue(
          sourceFile,
          node.expression,
          importsByLocalName,
        ),
      );
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  return returns;
}

function staticFunctionInitializersFromNode(
  sourceFile: ts.SourceFile,
  root: ts.Node,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): readonly StaticInitializerRecord[] {
  const initializers: StaticInitializerRecord[] = [];
  const visit = (node: ts.Node): void => {
    if (isFunctionLikeNode(node)) return;
    if (ts.isVariableDeclaration(node) && node.initializer) {
      initializers.push(
        ...staticInitializerRecordsFromDeclaration(
          sourceFile,
          node,
          importsByLocalName,
        ),
      );
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  return initializers;
}

function staticFunctionReturnValue(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): StaticSyntaxValue {
  const value = staticSyntaxValueFromExpression(
    sourceFile,
    expression,
    importsByLocalName,
  );
  if (value.kind !== "identifier") return value;
  const initializers = createStaticSyntaxInitializerMap(
    scopedVariableInitializerRecordsForNode(
      sourceFile,
      expression,
      value.name,
      importsByLocalName,
    ),
  );
  return resolveStaticSyntaxValue(value, initializers) ?? value;
}

function scopedVariableInitializerRecordsForNode(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  targetName: string,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): readonly StaticInitializerRecord[] {
  const records: StaticInitializerRecord[] = [];
  const ancestors: Array<ts.Block | ts.SourceFile> = [];
  let current = node.parent;
  while (current) {
    if (ts.isBlock(current) || ts.isSourceFile(current))
      ancestors.unshift(current);
    if (isFunctionLikeNode(current)) break;
    current = current.parent;
  }
  const nodeStart = node.getStart(sourceFile);
  for (const ancestor of ancestors) {
    for (const statement of ancestor.statements) {
      if (statement.getStart(sourceFile) >= nodeStart) break;
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!bindingNames(declaration.name).includes(targetName)) continue;
        records.push(
          ...staticInitializerRecordsFromDeclaration(
            sourceFile,
            declaration,
            importsByLocalName,
          ),
        );
      }
    }
  }
  return records;
}

function isFunctionLikeNode(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  );
}

function staticFunctionCallFromExpression(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): StaticFunctionCallValue {
  return {
    callee: staticCalleeRecordFromExpression(
      call.expression,
      importsByLocalName,
    ),
    ...(ts.isPropertyAccessExpression(call.expression) &&
    !ts.isCallExpression(call.expression.expression)
      ? {
          receiver: staticSyntaxValueFromExpression(
            sourceFile,
            call.expression.expression,
            importsByLocalName,
          ),
        }
      : {}),
    args: call.arguments.map((arg) =>
      staticSyntaxValueFromExpression(sourceFile, arg, importsByLocalName),
    ),
    source: sourceForNode(sourceFile, call),
  };
}
