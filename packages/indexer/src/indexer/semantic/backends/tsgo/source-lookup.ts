/**
 * Native source/declaration lookup for TypeScript-Go semantic analysis.
 *
 * This module is the native-preview counterpart to the temporary TypeScript
 * AST source cache. It resolves source files, declaration handles, and local
 * import/export declarations without parsing source text with JavaScript
 * TypeScript.
 *
 * @module
 */

import { dirname, resolve } from "node:path";
import {
  isImportClause,
  isImportDeclaration,
  isImportSpecifier,
  isNamedImports,
  isStringLiteral,
  type Node,
  type SourceFile,
} from "@typescript/native-preview/unstable/ast";
import { formatSyntaxKind } from "@typescript/native-preview/unstable/ast/utils";
import type {
  NodeHandle,
  Project,
  Symbol as TsgoSymbol,
} from "@typescript/native-preview/unstable/sync";
import {
  createNodeRangeIndex,
  nodeRangeFallbackKey,
  nodeRangeKey,
  type NodeRangeIndex,
} from "../../node-range-index";
import {
  createTsgoCanonicalExportIdentity,
  type TsgoCanonicalExportStatus,
} from "./canonical-export-identity";
import { createTsgoNativeExportDeclarations } from "./export-declarations";
import type { SemanticCacheValidationDependencyCollector } from "../../cache-validation";
import { nativeNodeList } from "./source";
import {
  isNativeDeclarationNode,
  nativeLocalDeclarations,
  nativeModuleExportNameText,
  nearestNativeImportDeclaration,
  tsgoNativeModuleCandidates,
  type TsgoNativeDeclaration,
} from "./native-source-declarations";

export interface TsgoNativeSourceLookup {
  /** Return native source files selected for analyzer candidate discovery. */
  readonly sourceFiles: (files: readonly string[]) => readonly SourceFile[];
  /** Return one native source file from the TypeScript-Go program. */
  readonly sourceFile: (file: string) => SourceFile | undefined;
  /** Resolve native declaration handles carried by a TypeScript-Go symbol. */
  readonly declarationsForSymbol: (
    symbol: TsgoSymbol,
  ) => readonly TsgoNativeDeclaration[];
  /** Resolve one native declaration handle in its originating program. */
  readonly declarationForHandle: (
    handle: NodeHandle,
  ) => TsgoNativeDeclaration | undefined;
  /** Resolve declarations represented by an import specifier range. */
  readonly importedDeclarations: (
    file: string,
    pos: number,
    end: number,
    kindName: string,
  ) => readonly TsgoNativeDeclaration[];
  /** Resolve local or imported declarations represented by an identifier name. */
  readonly sourceDeclarations: (
    file: string,
    name: string,
    pos?: number,
  ) => readonly TsgoNativeDeclaration[];
  /** Resolve a relative module specifier from an importing file. */
  readonly moduleSourceFile: (
    importingFile: string,
    moduleSpecifier: string,
  ) => SourceFile | undefined;
  /** Prove one node resolves to an exact package-root value export. */
  readonly isCanonicalExport: (
    node: Node,
    moduleName: string,
    exportName: string,
  ) => boolean;
  /** Classify canonical, resolved non-Crux, and unresolved tag identity. */
  readonly canonicalExportStatus: (
    node: Node,
    moduleName: string,
    exportName: string,
  ) => TsgoCanonicalExportStatus;
  /** Return whether a canonical tag uses a direct exact-root import binding. */
  readonly isDirectCanonicalImport: (
    node: Node,
    moduleName: string,
    exportName: string,
  ) => boolean;
}

export interface TsgoNativeSourceLookupOptions {
  /** Package roots rejected because compiler paths can intercept them. */
  readonly interceptedModuleNames?: ReadonlySet<string>;
  /** Exact package manifests used by canonical package proof. */
  readonly validationDependencies?: SemanticCacheValidationDependencyCollector;
}

/**
 * Creates native source lookup helpers for one TypeScript-Go project.
 *
 * Declaration and import lookups stay inside native-preview so native semantic
 * enrichment does not parse source through the JavaScript TypeScript AST.
 */
export function createTsgoNativeSourceLookup(
  project: Project,
  options: TsgoNativeSourceLookupOptions = {},
): TsgoNativeSourceLookup {
  const indexCache = new Map<string, NodeRangeIndex<Node>>();
  const canonicalExportIdentity = createTsgoCanonicalExportIdentity(project, {
    interceptedModuleNames: options.interceptedModuleNames,
    validationDependencies: options.validationDependencies,
  });
  const exportDeclarations = createTsgoNativeExportDeclarations({
    project,
    declarationForHandle,
    moduleSourceFile,
  });
  const lookup: TsgoNativeSourceLookup = {
    sourceFiles,
    sourceFile,
    declarationsForSymbol,
    declarationForHandle,
    importedDeclarations,
    sourceDeclarations,
    moduleSourceFile,
    isCanonicalExport: canonicalExportIdentity.matches,
    canonicalExportStatus: canonicalExportIdentity.status,
    isDirectCanonicalImport: canonicalExportIdentity.isDirectImport,
  };
  return lookup;

  function sourceFiles(files: readonly string[]): readonly SourceFile[] {
    return files.flatMap((file) => sourceFile(file) ?? []);
  }

  function sourceFile(file: string): SourceFile | undefined {
    return project.program.getSourceFile(resolve(file));
  }

  function declarationsForSymbol(
    symbol: TsgoSymbol,
  ): readonly TsgoNativeDeclaration[] {
    return symbol.declarations.flatMap(
      (handle) => declarationForHandle(handle) ?? [],
    );
  }

  function declarationForHandle(
    handle: NodeHandle,
  ): TsgoNativeDeclaration | undefined {
    const resolved = handle.resolve(project);
    return resolved && isNativeDeclarationNode(resolved) ? resolved : undefined;
  }

  function importedDeclarations(
    file: string,
    pos: number,
    end: number,
    kindName: string,
  ): readonly TsgoNativeDeclaration[] {
    const found = node(file, pos, end, kindName);
    if (!found || (!isImportSpecifier(found) && !isImportClause(found)))
      return [];
    const importDeclaration = nearestNativeImportDeclaration(found);
    const moduleSpecifier = importDeclaration?.moduleSpecifier;
    if (!moduleSpecifier || !isStringLiteral(moduleSpecifier)) return [];
    const importedSource = moduleSourceFile(file, moduleSpecifier.text);
    const importedName = isImportClause(found)
      ? "default"
      : (nativeModuleExportNameText(found.propertyName) ?? found.name.text);
    if (importedSource)
      return exportDeclarations.exportedDeclarations(
        importedSource,
        importedName,
      );
    return exportDeclarations.compilerResolvedDeclarations(
      isImportClause(found)
        ? (found.name ?? found)
        : (found.propertyName ?? found.name),
    );
  }

  function sourceDeclarations(
    file: string,
    name: string,
    pos?: number,
  ): readonly TsgoNativeDeclaration[] {
    const parsed = sourceFile(file);
    if (!parsed) return [];
    const local = nativeLocalDeclarations(parsed, name, pos);
    if (local.length > 0) return local;
    return importedDeclarationsByName(parsed, name);
  }

  function moduleSourceFile(
    importingFile: string,
    moduleSpecifier: string,
  ): SourceFile | undefined {
    if (!moduleSpecifier.startsWith(".")) return undefined;
    for (const candidate of tsgoNativeModuleCandidates(
      resolve(dirname(importingFile), moduleSpecifier),
    )) {
      const importedSource = sourceFile(candidate);
      if (importedSource) return importedSource;
    }
    return undefined;
  }

  function node(
    file: string,
    pos: number,
    end: number,
    kindName: string,
  ): Node | undefined {
    const parsed = sourceFile(file);
    if (!parsed) return undefined;
    const index = indexFor(parsed.fileName, parsed);
    return (
      index.byKey.get(nodeRangeKey(parsed.fileName, pos, end, kindName)) ??
      index.byRange.get(nodeRangeFallbackKey(pos, end))
    );
  }

  function indexFor(file: string, parsed: SourceFile): NodeRangeIndex<Node> {
    const existing = indexCache.get(file);
    if (existing) return existing;
    const index = createNodeRangeIndex<Node>(
      file,
      parsed,
      (entry) => formatSyntaxKind(entry.kind),
      (entry, visit) => entry.forEachChild(visit),
    );
    indexCache.set(file, index);
    return index;
  }

  function importedDeclarationsByName(
    source: SourceFile,
    name: string,
  ): readonly TsgoNativeDeclaration[] {
    for (const statement of nativeNodeList(source.statements)) {
      if (
        !isImportDeclaration(statement) ||
        !statement.importClause ||
        !isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      const namedBindings = statement.importClause.namedBindings;
      if (statement.importClause.name?.text === name) {
        const importedSource = moduleSourceFile(
          source.fileName,
          statement.moduleSpecifier.text,
        );
        return importedSource
          ? exportDeclarations.exportedDeclarations(importedSource, "default")
          : exportDeclarations.compilerResolvedDeclarations(
              statement.importClause.name,
            );
      }
      if (!namedBindings || !isNamedImports(namedBindings)) continue;
      for (const specifier of nativeNodeList(namedBindings.elements)) {
        if (specifier.name.text !== name) continue;
        const importedName =
          nativeModuleExportNameText(specifier.propertyName) ??
          specifier.name.text;
        const importedSource = moduleSourceFile(
          source.fileName,
          statement.moduleSpecifier.text,
        );
        return importedSource
          ? exportDeclarations.exportedDeclarations(
              importedSource,
              importedName,
            )
          : exportDeclarations.compilerResolvedDeclarations(
              specifier.propertyName ?? specifier.name,
            );
      }
    }
    return [];
  }
}
