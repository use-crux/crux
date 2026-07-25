import ts from "typescript";
import type { StaticCalleeRecord, StaticImportRecord } from "./types";

/** Normalizes a call, constructor, or tag expression into a stable callee record. */
export function staticCalleeRecordFromExpression(
  expression: ts.Expression,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): StaticCalleeRecord {
  const localName = expressionName(expression);
  const direct = ts.isIdentifier(expression);
  const receiverName =
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
      ? expression.expression.text
      : undefined;
  if (!localName) return { name: "<unknown>", direct };

  const imported = importRecordForCallee(expression, importsByLocalName);
  if (!imported)
    return {
      name: localName,
      localName,
      direct,
      ...(receiverName ? { receiverName } : {}),
    };

  const importedName = ts.isPropertyAccessExpression(expression)
    ? localName
    : imported.importedName;
  return {
    name: importedName,
    direct,
    localName: imported.localName,
    ...(receiverName ? { receiverName } : {}),
    importedName,
    moduleSpecifier: imported.moduleSpecifier,
    ...(imported.resolvedFile ? { resolvedFile: imported.resolvedFile } : {}),
  };
}

/** Returns the final user-facing name for a simple callable or tag expression. */
export function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function importRecordForCallee(
  expression: ts.Expression,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): StaticImportRecord | undefined {
  if (ts.isIdentifier(expression)) {
    const imported = importsByLocalName.get(expression.text);
    return imported && !isLexicallyShadowed(expression, expression.text)
      ? imported
      : undefined;
  }
  if (!ts.isPropertyAccessExpression(expression)) return undefined;

  let receiver: ts.Expression = expression.expression;
  while (ts.isPropertyAccessExpression(receiver))
    receiver = receiver.expression;
  if (!ts.isIdentifier(receiver)) return undefined;
  const imported = importsByLocalName.get(receiver.text);
  return imported && !isLexicallyShadowed(receiver, receiver.text)
    ? imported
    : undefined;
}

const importBindingsBySourceFile = new WeakMap<
  ts.SourceFile,
  TypeScriptImportBindings
>();

interface TypeScriptImportBindings {
  readonly checker: ts.TypeChecker;
  readonly symbolsByLocalName: ReadonlyMap<string, ts.Symbol>;
}

/**
 * Rejects name-only import evidence when TypeScript's binder resolves the
 * callee identifier to a nearer lexical declaration.
 *
 * A no-lib, no-resolution program is sufficient here: this check compares the
 * local import binding with the local reference binding and never follows the
 * imported module or assigns semantic meaning.
 */
function isLexicallyShadowed(reference: ts.Identifier, name: string): boolean {
  const bindings = typeScriptImportBindings(reference.getSourceFile());
  const imported = bindings.symbolsByLocalName.get(name);
  const referenced = bindings.checker.getSymbolAtLocation(reference);
  return !imported || referenced !== imported;
}

function typeScriptImportBindings(
  sourceFile: ts.SourceFile,
): TypeScriptImportBindings {
  const existing = importBindingsBySourceFile.get(sourceFile);
  if (existing) return existing;

  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    module: ts.ModuleKind.ESNext,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
    types: [],
  };
  const host = ts.createCompilerHost(options, true);
  host.fileExists = (fileName) => fileName === sourceFile.fileName;
  host.readFile = (fileName) =>
    fileName === sourceFile.fileName ? sourceFile.text : undefined;
  host.getSourceFile = (fileName) =>
    fileName === sourceFile.fileName ? sourceFile : undefined;
  const program = ts.createProgram({
    rootNames: [sourceFile.fileName],
    options,
    host,
  });
  const checker = program.getTypeChecker();
  const symbolsByLocalName = new Map<string, ts.Symbol>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) addImportSymbol(clause.name);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      addImportSymbol(bindings.name);
    } else if (bindings) {
      for (const specifier of bindings.elements)
        addImportSymbol(specifier.name);
    }
  }
  const created = { checker, symbolsByLocalName };
  importBindingsBySourceFile.set(sourceFile, created);
  return created;

  function addImportSymbol(identifier: ts.Identifier): void {
    const symbol = checker.getSymbolAtLocation(identifier);
    if (symbol) symbolsByLocalName.set(identifier.text, symbol);
  }
}
