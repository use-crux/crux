import ts from "typescript";

export interface TypeScriptTagSite {
  readonly declaration: ts.Declaration;
  readonly exportName: string;
  readonly terminal: ts.Symbol;
}

/** Resolves a TypeScript tag expression to its authored value import. */
export function tagSite(
  node: ts.Node,
  checker: ts.TypeChecker,
): TypeScriptTagSite | undefined {
  const location = ts.isPropertyAccessExpression(node) ? node.name : node;
  const terminal = canonicalSymbol(
    checker.getSymbolAtLocation(location),
    checker,
  );
  if (!terminal) return undefined;

  if (ts.isPropertyAccessExpression(node)) {
    if (!ts.isIdentifier(node.expression)) return undefined;
    const namespace = checker.getSymbolAtLocation(node.expression);
    const declaration = namespace?.declarations?.find(ts.isNamespaceImport);
    if (declaration?.parent.isTypeOnly) return undefined;
    return declaration
      ? { declaration, exportName: node.name.text, terminal }
      : undefined;
  }

  if (!ts.isIdentifier(node)) return undefined;
  const binding = checker.getSymbolAtLocation(node);
  const declaration = binding?.declarations?.find(
    (candidate) =>
      ts.isImportSpecifier(candidate) || ts.isImportClause(candidate),
  );
  if (!declaration) return undefined;
  const exportName = ts.isImportSpecifier(declaration)
    ? (moduleExportName(declaration.propertyName) ?? declaration.name.text)
    : "default";
  return { declaration, exportName, terminal };
}

/** Follows value aliases while rejecting type-only or cyclic routes. */
export function canonicalSymbol(
  symbol: ts.Symbol | undefined,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  let current = symbol;
  const seen = new Set<ts.Symbol>();
  while (current && (current.flags & ts.SymbolFlags.Alias) !== 0) {
    if (seen.has(current) || isTypeOnlyAlias(current)) return undefined;
    seen.add(current);
    const next = checker.getImmediateAliasedSymbol(current);
    if (!next || next === current) return undefined;
    current = next;
  }
  return current;
}

/** Returns the nearest authored import declaration that owns a binding. */
export function nearestImportDeclaration(
  node: ts.Node,
): ts.ImportDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isImportDeclaration(current)) return current;
    current = current.parent;
  }
  return undefined;
}

/** Reads an identifier or string-literal module export name. */
export function moduleExportName(name: ts.ModuleExportName | undefined) {
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name))
    ? name.text
    : undefined;
}

function isTypeOnlyAlias(symbol: ts.Symbol): boolean {
  return (symbol.declarations ?? []).some((declaration) => {
    if (ts.isImportSpecifier(declaration)) {
      return declaration.isTypeOnly || declaration.parent.parent.isTypeOnly;
    }
    if (ts.isNamespaceImport(declaration)) return declaration.parent.isTypeOnly;
    if (ts.isImportClause(declaration)) return declaration.isTypeOnly;
    if (ts.isExportSpecifier(declaration)) {
      return (
        declaration.isTypeOnly ||
        (ts.isExportDeclaration(declaration.parent.parent) &&
          declaration.parent.parent.isTypeOnly)
      );
    }
    return ts.isExportDeclaration(declaration) && declaration.isTypeOnly;
  });
}
