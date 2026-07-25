/**
 * Native TypeScript-Go export declaration resolution.
 *
 * This module follows local ECMAScript export syntax and compiler-resolved
 * package exports without parsing source through JavaScript TypeScript.
 *
 * @module
 */

import {
  isExportAssignment,
  isExportDeclaration,
  isExportSpecifier,
  isIdentifier,
  isNamedExports,
  isStringLiteral,
  type ExportDeclaration,
  type Node,
  type SourceFile,
} from "@typescript/native-preview/unstable/ast";
import type {
  NodeHandle,
  Project,
} from "@typescript/native-preview/unstable/sync";
import {
  nativeModuleExportNameText,
  nativeTopLevelDeclarations,
  type TsgoNativeDeclaration,
} from "./native-source-declarations";
import { nativeNodeList } from "./source";

export interface TsgoNativeExportDeclarations {
  /** Resolve one exported name to an unambiguous terminal declaration. */
  readonly exportedDeclarations: (
    source: SourceFile,
    exportedName: string,
  ) => readonly TsgoNativeDeclaration[];
  /** Resolve one compiler-owned import/export binding to terminal declarations. */
  readonly compilerResolvedDeclarations: (
    node: Node,
  ) => readonly TsgoNativeDeclaration[];
}

export interface TsgoNativeExportDeclarationsInput {
  readonly project: Project;
  readonly declarationForHandle: (
    handle: NodeHandle,
  ) => TsgoNativeDeclaration | undefined;
  readonly moduleSourceFile: (
    importingFile: string,
    moduleSpecifier: string,
  ) => SourceFile | undefined;
}

/** Creates cycle-safe native export declaration resolution for one project. */
export function createTsgoNativeExportDeclarations(
  input: TsgoNativeExportDeclarationsInput,
): TsgoNativeExportDeclarations {
  return { exportedDeclarations, compilerResolvedDeclarations };

  function compilerResolvedDeclarations(
    node: Node,
  ): readonly TsgoNativeDeclaration[] {
    return compilerResolvedExportDeclarations(node, new Set(), new Set());
  }

  function exportedDeclarations(
    source: SourceFile,
    exportedName: string,
    visitedExports: ReadonlySet<string> = new Set(),
  ): readonly TsgoNativeDeclaration[] {
    const key = `${source.fileName}\0${exportedName}`;
    if (visitedExports.has(key)) return [];
    const nextVisitedExports = new Set(visitedExports);
    nextVisitedExports.add(key);

    const direct = nativeTopLevelDeclarations(source, exportedName, true);
    if (direct.length > 0) return direct;
    if (exportedName === "default") {
      const assigned = defaultExportDeclarations(source);
      if (assigned.length > 0) return assigned;
    }

    const starDeclarations: TsgoNativeDeclaration[] = [];
    for (const statement of nativeNodeList(source.statements)) {
      if (!isExportDeclaration(statement) || statement.isTypeOnly) continue;
      if (!statement.exportClause) {
        collectStarDeclarations(
          starDeclarations,
          source,
          statement.moduleSpecifier,
          exportedName,
          nextVisitedExports,
        );
        continue;
      }
      if (!isNamedExports(statement.exportClause)) continue;
      for (const specifier of nativeNodeList(statement.exportClause.elements)) {
        if (nativeModuleExportNameText(specifier.name) !== exportedName)
          continue;
        const localName =
          nativeModuleExportNameText(specifier.propertyName) ??
          nativeModuleExportNameText(specifier.name);
        if (!localName) continue;
        if (!statement.moduleSpecifier)
          return nativeTopLevelDeclarations(source, localName, false);
        if (!isStringLiteral(statement.moduleSpecifier)) continue;
        const reexportSource = input.moduleSourceFile(
          source.fileName,
          statement.moduleSpecifier.text,
        );
        return reexportSource
          ? exportedDeclarations(reexportSource, localName, nextVisitedExports)
          : compilerResolvedExportDeclarations(
              specifier.propertyName ?? specifier.name,
              new Set(),
              nextVisitedExports,
            );
      }
    }
    return unambiguousDeclarations(starDeclarations);
  }

  function collectStarDeclarations(
    declarations: TsgoNativeDeclaration[],
    source: SourceFile,
    moduleSpecifier: Node | undefined,
    exportedName: string,
    visitedExports: ReadonlySet<string>,
  ): void {
    if (
      exportedName === "default" ||
      !moduleSpecifier ||
      !isStringLiteral(moduleSpecifier)
    ) {
      return;
    }
    const reexportSource = input.moduleSourceFile(
      source.fileName,
      moduleSpecifier.text,
    );
    if (reexportSource) {
      declarations.push(
        ...exportedDeclarations(reexportSource, exportedName, visitedExports),
      );
    }
  }

  function defaultExportDeclarations(
    source: SourceFile,
  ): readonly TsgoNativeDeclaration[] {
    for (const statement of nativeNodeList(source.statements)) {
      if (
        !isExportAssignment(statement) ||
        statement.isExportEquals ||
        !isIdentifier(statement.expression)
      ) {
        continue;
      }
      const declarations = nativeTopLevelDeclarations(
        source,
        statement.expression.text,
        false,
      );
      if (declarations.length > 0) return declarations;
    }
    return [];
  }

  /**
   * Follows compiler-resolved export symbols when local source lookup cannot
   * represent package resolution. The active compiler remains authoritative
   * for pnpm and package `exports` semantics.
   */
  function compilerResolvedExportDeclarations(
    node: Node,
    visitedSymbols: Set<number>,
    visitedExports: ReadonlySet<string>,
  ): readonly TsgoNativeDeclaration[] {
    const symbol =
      (isIdentifier(node)
        ? input.project.checker.getResolvedSymbol(node)
        : undefined) ?? input.project.checker.getSymbolAtLocation(node);
    if (!symbol || visitedSymbols.has(symbol.id)) return [];
    visitedSymbols.add(symbol.id);

    return symbol.declarations.flatMap((handle) => {
      const declaration = input.declarationForHandle(handle);
      if (!declaration) return [];
      if (!isExportSpecifier(declaration)) return [declaration];

      const exportDeclaration = nearestExportDeclaration(declaration);
      const moduleSpecifier = exportDeclaration?.moduleSpecifier;
      const exportedName =
        nativeModuleExportNameText(declaration.propertyName) ??
        declaration.name.text;
      if (!moduleSpecifier) {
        return nativeTopLevelDeclarations(
          declaration.getSourceFile(),
          exportedName,
          false,
        );
      }
      if (!isStringLiteral(moduleSpecifier)) return [];

      const reexportSource = input.moduleSourceFile(
        declaration.getSourceFile().fileName,
        moduleSpecifier.text,
      );
      return reexportSource
        ? exportedDeclarations(reexportSource, exportedName, visitedExports)
        : compilerResolvedExportDeclarations(
            declaration.propertyName ?? declaration.name,
            visitedSymbols,
            visitedExports,
          );
    });
  }
}

function nearestExportDeclaration(node: Node): ExportDeclaration | undefined {
  let current: Node | undefined = node.parent;
  while (current && current.kind !== current.getSourceFile().kind) {
    if (isExportDeclaration(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function unambiguousDeclarations(
  declarations: readonly TsgoNativeDeclaration[],
): readonly TsgoNativeDeclaration[] {
  const unique = new Map<string, TsgoNativeDeclaration>();
  for (const declaration of declarations) {
    const source = declaration.getSourceFile();
    unique.set(
      `${source.fileName}:${declaration.pos}:${declaration.end}`,
      declaration,
    );
  }
  return unique.size === 1 ? [...unique.values()] : [];
}
