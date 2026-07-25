/**
 * Native TypeScript-Go declaration helpers.
 *
 * These functions mirror the declaration lookup behavior needed by the shared
 * analyzer without depending on JavaScript TypeScript AST nodes.
 *
 * @module
 */

import { extname } from "node:path";
import {
  ModifierFlags,
  isClassDeclaration,
  isEnumDeclaration,
  isExportSpecifier,
  isFunctionDeclaration,
  isIdentifier,
  isImportClause,
  isImportDeclaration,
  isImportSpecifier,
  isInterfaceDeclaration,
  isMethodDeclaration,
  isNamespaceImport,
  isParameterDeclaration,
  isPropertyAssignment,
  isPropertyDeclaration,
  isShorthandPropertyAssignment,
  isStringLiteral,
  isTypeAliasDeclaration,
  isVariableDeclaration,
  isVariableStatement,
  type Declaration,
  type ImportDeclaration,
  type ModuleExportName,
  type Node,
  type PropertyName,
  type SourceFile,
} from "@typescript/native-preview/unstable/ast";
import { formatSyntaxKind } from "@typescript/native-preview/unstable/ast/utils";
import { nativeNodeList } from "./source";

export type TsgoNativeDeclaration = Declaration & Node;

interface NodeWithModifierFlags extends Node {
  readonly modifierFlags: number;
}

/** Returns candidate source paths for a relative TypeScript module specifier. */
export function tsgoNativeModuleCandidates(base: string): readonly string[] {
  if (extname(base)) return [base];
  return [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.mts`,
    `${base}/index.cts`,
  ];
}

/** Returns the nearest import declaration that owns an import specifier node. */
export function nearestNativeImportDeclaration(
  node: Node,
): ImportDeclaration | undefined {
  let current: Node | undefined = node;
  while (current && current.kind !== current.getSourceFile().kind) {
    if (isImportDeclaration(current)) return current;
    current = current.parent;
  }
  return undefined;
}

/**
 * Finds a declaration by stable symbol data when native declaration handles
 * use ranges that cannot be resolved directly.
 */
export function nearestNativeNamedDeclaration(
  sourceFile: SourceFile,
  pos: number,
  end: number,
  kindName: string,
  name: string,
): TsgoNativeDeclaration | undefined {
  const candidates: TsgoNativeDeclaration[] = [];
  const visit = (node: Node): void => {
    if (
      isNativeDeclarationNode(node) &&
      formatSyntaxKind(node.kind) === kindName &&
      nativeDeclarationName(node) === name
    ) {
      candidates.push(node);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return candidates.sort(
    (left, right) =>
      rangeDistance(left, pos, end) - rangeDistance(right, pos, end),
  )[0];
}

/** Returns local binding declarations visible before an identifier reference. */
export function nativeLocalDeclarations(
  sourceFile: SourceFile,
  name: string,
  pos: number | undefined,
): readonly TsgoNativeDeclaration[] {
  const declarations: TsgoNativeDeclaration[] = [];
  const visit = (node: Node): void => {
    if (
      isIdentifierBindingDeclaration(node) &&
      nativeDeclarationName(node) === name &&
      (pos === undefined || node.pos <= pos)
    ) {
      declarations.push(node);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return declarations.sort((left, right) => right.pos - left.pos);
}

/** Returns top-level named declarations, optionally requiring `export`. */
export function nativeTopLevelDeclarations(
  sourceFile: SourceFile,
  name: string,
  requireExport: boolean,
): readonly TsgoNativeDeclaration[] {
  const declarations: TsgoNativeDeclaration[] = [];
  for (const statement of nativeNodeList(sourceFile.statements)) {
    if (requireExport && !hasExportModifier(statement)) continue;
    if (isVariableStatement(statement)) {
      declarations.push(
        ...nativeNodeList(statement.declarationList.declarations).filter(
          (entry) => isIdentifier(entry.name) && entry.name.text === name,
        ),
      );
      continue;
    }
    if (isNamedDeclaration(statement, name)) declarations.push(statement);
  }
  return declarations;
}

/** Returns whether a native node is a declaration usable by semantic lookup. */
export function isNativeDeclarationNode(
  node: Node,
): node is TsgoNativeDeclaration {
  return (
    isVariableDeclaration(node) ||
    isFunctionDeclaration(node) ||
    isPropertyAssignment(node) ||
    isShorthandPropertyAssignment(node) ||
    isMethodDeclaration(node) ||
    isParameterDeclaration(node) ||
    isPropertyDeclaration(node) ||
    isClassDeclaration(node) ||
    isInterfaceDeclaration(node) ||
    isTypeAliasDeclaration(node) ||
    isEnumDeclaration(node) ||
    isImportClause(node) ||
    isImportSpecifier(node) ||
    isExportSpecifier(node) ||
    isNamespaceImport(node)
  );
}

/** Returns the source-level name for a native declaration when one exists. */
export function nativeDeclarationName(
  node: TsgoNativeDeclaration,
): string | undefined {
  if (isVariableDeclaration(node) && isIdentifier(node.name))
    return node.name.text;
  if (
    (isFunctionDeclaration(node) ||
      isClassDeclaration(node) ||
      isInterfaceDeclaration(node) ||
      isTypeAliasDeclaration(node) ||
      isEnumDeclaration(node)) &&
    node.name
  ) {
    return node.name.text;
  }
  if (
    isPropertyAssignment(node) ||
    isShorthandPropertyAssignment(node) ||
    isMethodDeclaration(node)
  ) {
    return propertyNameText(node.name);
  }
  if (isImportSpecifier(node)) return node.name.text;
  if (isImportClause(node)) return node.name?.text;
  if (isExportSpecifier(node)) return node.name.text;
  if (isNamespaceImport(node)) return node.name.text;
  return undefined;
}

/** Returns the authored text for a module export name. */
export function nativeModuleExportNameText(
  name: ModuleExportName | undefined,
): string | undefined {
  return name && (isIdentifier(name) || isStringLiteral(name))
    ? name.text
    : undefined;
}

function isIdentifierBindingDeclaration(
  node: Node,
): node is TsgoNativeDeclaration {
  return (
    isVariableDeclaration(node) ||
    isFunctionDeclaration(node) ||
    isClassDeclaration(node) ||
    isInterfaceDeclaration(node) ||
    isTypeAliasDeclaration(node) ||
    isEnumDeclaration(node)
  );
}

function isNamedDeclaration(
  node: Node,
  name: string,
): node is TsgoNativeDeclaration {
  return (
    (isFunctionDeclaration(node) ||
      isClassDeclaration(node) ||
      isInterfaceDeclaration(node) ||
      isTypeAliasDeclaration(node) ||
      isEnumDeclaration(node)) &&
    node.name?.text === name
  );
}

function propertyNameText(name: PropertyName): string | undefined {
  if (isIdentifier(name) || isStringLiteral(name)) return name.text;
  return undefined;
}

function hasExportModifier(node: Node): boolean {
  return (
    hasModifierFlags(node) && Boolean(node.modifierFlags & ModifierFlags.Export)
  );
}

function hasModifierFlags(node: Node): node is NodeWithModifierFlags {
  return (
    typeof (node as Partial<NodeWithModifierFlags>).modifierFlags === "number"
  );
}

function rangeDistance(node: Node, pos: number, end: number): number {
  return Math.abs(node.pos - pos) + Math.abs(node.end - end);
}
