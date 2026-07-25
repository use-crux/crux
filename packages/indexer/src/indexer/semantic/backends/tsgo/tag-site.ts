import {
  SyntaxKind,
  isIdentifier,
  isImportClause,
  isImportSpecifier,
  isNamespaceImport,
  isPropertyAccessExpression,
  type Node,
} from "@typescript/native-preview/unstable/ast";
import type {
  Project,
  Symbol as TsgoSymbol,
} from "@typescript/native-preview/unstable/sync";
import { nearestNativeImportDeclaration } from "./native-source-declarations";

export interface TsgoTagSite {
  readonly declaration: Node;
  readonly exportName: string;
  readonly terminal: TsgoSymbol;
}

/**
 * Resolves a native tagged-template tag to its authored import binding.
 *
 * Namespace imports are checked at the namespace declaration because the
 * checker exposes the property access name as the terminal export symbol.
 */
export function tsgoTagSite(
  node: Node,
  project: Project,
  terminalSymbol: (
    symbol: TsgoSymbol | undefined,
  ) => TsgoSymbol | "type-only" | undefined,
): TsgoTagSite | undefined {
  const location = isPropertyAccessExpression(node) ? node.name : node;
  const terminal = terminalSymbol(
    project.checker.getSymbolAtLocation(location),
  );
  if (!terminal || terminal === "type-only") return undefined;

  if (isPropertyAccessExpression(node)) {
    if (!isIdentifier(node.expression)) return undefined;
    const namespace = project.checker.getSymbolAtLocation(node.expression);
    const declaration = namespace?.declarations
      .map((handle) => handle.resolve(project))
      .find((candidate) => candidate && isNamespaceImport(candidate));
    if (
      declaration &&
      nearestNativeImportDeclaration(declaration)?.importClause
        ?.phaseModifier === SyntaxKind.TypeKeyword
    ) {
      return undefined;
    }
    return declaration
      ? { declaration, exportName: node.name.text, terminal }
      : undefined;
  }

  if (!isIdentifier(node)) return undefined;
  const binding = project.checker.getSymbolAtLocation(node);
  const declaration = binding?.declarations
    .map((handle) => handle.resolve(project))
    .find(
      (candidate) =>
        candidate &&
        (isImportSpecifier(candidate) || isImportClause(candidate)),
    );
  if (!declaration) return undefined;
  const exportName = isImportSpecifier(declaration)
    ? declaration.propertyName?.text || declaration.name.text
    : "default";
  return { declaration, exportName, terminal };
}
