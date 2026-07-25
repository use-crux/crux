/**
 * Compiler-proven package export identity for the TypeScript-Go backend.
 *
 * This is the only native adapter concern allowed to follow compiler aliases.
 * It fails closed on unresolved, cyclic, ambiguous, or type-only evidence.
 *
 * @module
 */

import {
  SyntaxKind,
  isExportDeclaration,
  isExportSpecifier,
  isIdentifier,
  isImportClause,
  isImportDeclaration,
  isImportSpecifier,
  isNamespaceImport,
  isPropertyAccessExpression,
  isStringLiteral,
  type ExportDeclaration,
  type ImportDeclaration,
  type Node,
} from "@typescript/native-preview/unstable/ast";
import {
  SymbolFlags,
  type Project,
  type Symbol as TsgoSymbol,
} from "@typescript/native-preview/unstable/sync";
import { pathsInterceptModule } from "../../compiler-options";
import type { SemanticCacheValidationDependencyCollector } from "../../cache-validation";
import { tsgoCanonicalExportProof } from "./export-provenance";
import { createTsgoPackageManifestIdentity } from "./package-manifest";

export type TsgoCanonicalExportStatus =
  | "canonical"
  | "resolved-other"
  | "unresolved";

export interface TsgoCanonicalExportIdentity {
  /** Classify one tag binding through the active compiler project. */
  readonly status: (
    node: Node,
    moduleName: string,
    exportName: string,
  ) => TsgoCanonicalExportStatus;
  /** Return whether one tag is the exact requested package-root export. */
  readonly matches: (
    node: Node,
    moduleName: string,
    exportName: string,
  ) => boolean;
  /** Return whether canonical identity comes from a direct exact-root import. */
  readonly isDirectImport: (
    node: Node,
    moduleName: string,
    exportName: string,
  ) => boolean;
}

export interface TsgoCanonicalExportIdentityOptions {
  /** Package roots rejected because compiler paths can intercept them. */
  readonly interceptedModuleNames?: ReadonlySet<string>;
  /** Exact package manifests used by canonical package proof. */
  readonly validationDependencies?: SemanticCacheValidationDependencyCollector;
}

/** Creates exact package-root export identity operations for one native project. */
export function createTsgoCanonicalExportIdentity(
  project: Project,
  options: TsgoCanonicalExportIdentityOptions = {},
): TsgoCanonicalExportIdentity {
  const packageManifestMatches = createTsgoPackageManifestIdentity(
    project,
    options.validationDependencies,
  );

  return { status, matches, isDirectImport };

  function matches(
    node: Node,
    moduleName: string,
    exportName: string,
  ): boolean {
    return status(node, moduleName, exportName) === "canonical";
  }

  function status(
    node: Node,
    moduleName: string,
    exportName: string,
  ): TsgoCanonicalExportStatus {
    if (
      options.interceptedModuleNames?.has(moduleName) ||
      pathsInterceptModule(
        project.program.getCompilerOptions().paths,
        moduleName,
      )
    ) {
      return "unresolved";
    }
    if (isTypeOnlyNamespaceAccess(node)) return "resolved-other";
    const location = isPropertyAccessExpression(node) ? node.name : node;
    if (!isIdentifier(location)) return "unresolved";

    const site = terminalSymbol(project.checker.getSymbolAtLocation(location));
    if (site === "type-only") return "resolved-other";
    if (!site) return "unresolved";
    const packageTerminals = new Map<number, TsgoSymbol>();
    const proof = tsgoCanonicalExportProof(node, moduleName, {
      project,
      terminalSymbol,
      canonicalPackageEdge: (moduleSpecifier, module, expectedModuleName) =>
        canonicalPackageEdge(
          moduleSpecifier,
          module,
          expectedModuleName || moduleName,
          exportName,
          packageTerminals,
        ),
    });
    return proof &&
      proof.site.id === site.id &&
      proof.terminal.id === site.id &&
      packageTerminals.size === 1 &&
      packageTerminals.has(proof.terminal.id)
      ? "canonical"
      : "resolved-other";
  }

  function isDirectImport(
    node: Node,
    moduleName: string,
    exportName: string,
  ): boolean {
    if (status(node, moduleName, exportName) !== "canonical") return false;

    if (isPropertyAccessExpression(node)) {
      if (node.name.text !== exportName || !isIdentifier(node.expression)) {
        return false;
      }
      const namespace = project.checker.getSymbolAtLocation(node.expression);
      return Boolean(
        namespace?.declarations.some((handle) => {
          const declaration = handle.resolve(project);
          return (
            declaration &&
            isNamespaceImport(declaration) &&
            importMatches(owningImport(declaration), moduleName)
          );
        }),
      );
    }

    if (!isIdentifier(node)) return false;
    const binding = project.checker.getSymbolAtLocation(node);
    return Boolean(
      binding?.declarations.some((handle) => {
        const declaration = handle.resolve(project);
        if (!declaration || !isImportSpecifier(declaration)) return false;
        const importedName =
          declaration.propertyName && isIdentifier(declaration.propertyName)
            ? declaration.propertyName.text
            : declaration.name.text;
        return (
          importedName === exportName &&
          importMatches(owningImport(declaration), moduleName)
        );
      }),
    );
  }

  function canonicalPackageEdge(
    moduleSpecifier: Node,
    module: TsgoSymbol,
    moduleName: string,
    exportName: string,
    packageTerminals: Map<number, TsgoSymbol>,
  ): boolean {
    if (
      !isStringLiteral(moduleSpecifier) ||
      moduleSpecifier.text !== moduleName
    ) {
      return false;
    }
    if (!packageManifestMatches(module, moduleName)) return false;
    const rootExport = project.checker
      .getExportsOfModule(module)
      .find((symbol) => symbol.name === exportName);
    const terminal = terminalSymbol(rootExport);
    if (!terminal || terminal === "type-only") return false;
    packageTerminals.set(terminal.id, terminal);
    return true;
  }

  function terminalSymbol(
    symbol: TsgoSymbol | undefined,
  ): TsgoSymbol | "type-only" | undefined {
    if (!symbol || project.checker.isUnknownSymbol(symbol)) return undefined;
    if ((symbol.flags & SymbolFlags.Alias) === 0) return symbol;

    const compilerTerminal = project.checker.getAliasedSymbol(symbol);
    if (project.checker.isUnknownSymbol(compilerTerminal)) return undefined;

    let current = symbol;
    const visited = new Set<number>();
    while ((current.flags & SymbolFlags.Alias) !== 0) {
      if (visited.has(current.id)) return undefined;
      if (isTypeOnlyAlias(current)) return "type-only";
      visited.add(current.id);
      const next = project.checker.getImmediateAliasedSymbol(current);
      if (!next || project.checker.isUnknownSymbol(next)) return undefined;
      current = next;
    }

    return current.id === compilerTerminal.id ? compilerTerminal : undefined;
  }

  function isTypeOnlyAlias(symbol: TsgoSymbol): boolean {
    return symbol.declarations.some((handle) => {
      const declaration = handle.resolve(project);
      if (!declaration) return true;
      if (isImportSpecifier(declaration)) {
        return (
          declaration.isTypeOnly ||
          owningImport(declaration)?.importClause?.phaseModifier ===
            SyntaxKind.TypeKeyword
        );
      }
      if (isImportClause(declaration)) {
        return declaration.phaseModifier === SyntaxKind.TypeKeyword;
      }
      if (isNamespaceImport(declaration)) {
        return (
          owningImport(declaration)?.importClause?.phaseModifier ===
          SyntaxKind.TypeKeyword
        );
      }
      if (isExportSpecifier(declaration)) {
        const owner = owningExport(declaration);
        return declaration.isTypeOnly || owner?.isTypeOnly === true;
      }
      return false;
    });
  }

  function isTypeOnlyNamespaceAccess(node: Node): boolean {
    if (!isPropertyAccessExpression(node) || !isIdentifier(node.expression)) {
      return false;
    }
    const namespace = project.checker.getSymbolAtLocation(node.expression);
    return namespace ? isTypeOnlyAlias(namespace) : false;
  }
}

function importMatches(
  declaration: ImportDeclaration | undefined,
  moduleName: string,
): boolean {
  return Boolean(
    declaration &&
    declaration.importClause?.phaseModifier !== SyntaxKind.TypeKeyword &&
    isStringLiteral(declaration.moduleSpecifier) &&
    declaration.moduleSpecifier.text === moduleName,
  );
}

function owningImport(node: Node): ImportDeclaration | undefined {
  let current: Node | undefined = node.parent;
  while (current && current.kind !== current.getSourceFile().kind) {
    if (isImportDeclaration(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function owningExport(node: Node): ExportDeclaration | undefined {
  let current: Node | undefined = node.parent;
  while (current && current.kind !== current.getSourceFile().kind) {
    if (isExportDeclaration(current)) return current;
    current = current.parent;
  }
  return undefined;
}
