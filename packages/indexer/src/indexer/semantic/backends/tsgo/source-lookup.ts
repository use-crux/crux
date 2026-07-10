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

import { dirname, resolve } from 'node:path'
import {
  isExportDeclaration,
  isImportDeclaration,
  isImportSpecifier,
  isNamedExports,
  isNamedImports,
  isStringLiteral,
  type Node,
  type SourceFile,
} from '@typescript/native-preview/unstable/ast'
import { formatSyntaxKind } from '@typescript/native-preview/unstable/ast/utils'
import type { NodeHandle, Project, Symbol as TsgoSymbol } from '@typescript/native-preview/unstable/sync'
import {
  createNodeRangeIndex,
  nodeRangeFallbackKey,
  nodeRangeKey,
  type NodeRangeIndex,
} from '../../node-range-index'
import { nativeNodeList } from './source'
import {
  isNativeDeclarationNode,
  nativeLocalDeclarations,
  nativeModuleExportNameText,
  nativeTopLevelDeclarations,
  nearestNativeImportDeclaration,
  nearestNativeNamedDeclaration,
  tsgoNativeModuleCandidates,
  type TsgoNativeDeclaration,
} from './native-source-declarations'

export interface TsgoNativeSourceLookup {
  /** Return native source files selected for analyzer candidate discovery. */
  readonly sourceFiles: (files: readonly string[]) => readonly SourceFile[]
  /** Return one native source file from the TypeScript-Go program. */
  readonly sourceFile: (file: string) => SourceFile | undefined
  /** Resolve native declaration handles carried by a TypeScript-Go symbol. */
  readonly declarationsForSymbol: (symbol: TsgoSymbol) => readonly TsgoNativeDeclaration[]
  /** Resolve one native declaration handle, with a nearest-name fallback for shifted ranges. */
  readonly declarationForHandle: (handle: NodeHandle, name?: string) => TsgoNativeDeclaration | undefined
  /** Resolve declarations represented by an import specifier range. */
  readonly importedDeclarations: (file: string, pos: number, end: number, kindName: string) => readonly TsgoNativeDeclaration[]
  /** Resolve local or imported declarations represented by an identifier name. */
  readonly sourceDeclarations: (file: string, name: string, pos?: number) => readonly TsgoNativeDeclaration[]
  /** Resolve a relative module specifier from an importing file. */
  readonly moduleSourceFile: (importingFile: string, moduleSpecifier: string) => SourceFile | undefined
}

/**
 * Creates native source lookup helpers for one TypeScript-Go project.
 *
 * Declaration and import lookups stay inside native-preview so native semantic
 * enrichment does not parse source through the JavaScript TypeScript AST.
 */
export function createTsgoNativeSourceLookup(project: Project): TsgoNativeSourceLookup {
  const indexCache = new Map<string, NodeRangeIndex<Node>>()
  const lookup: TsgoNativeSourceLookup = {
    sourceFiles,
    sourceFile,
    declarationsForSymbol,
    declarationForHandle,
    importedDeclarations,
    sourceDeclarations,
    moduleSourceFile,
  }
  return lookup

  function sourceFiles(files: readonly string[]): readonly SourceFile[] {
    return files.flatMap((file) => sourceFile(file) ?? [])
  }

  function sourceFile(file: string): SourceFile | undefined {
    return project.program.getSourceFile(resolve(file))
  }

  function declarationsForSymbol(symbol: TsgoSymbol): readonly TsgoNativeDeclaration[] {
    return symbol.declarations.flatMap((handle) => declarationForHandle(handle, symbol.name) ?? [])
  }

  function declarationForHandle(handle: NodeHandle, name?: string): TsgoNativeDeclaration | undefined {
    const resolved = handle.resolve(project)
    if (resolved && isNativeDeclarationNode(resolved)) return resolved
    const parsed = sourceFile(String(handle.path))
    return name && parsed ? nearestNativeNamedDeclaration(parsed, handle.pos, handle.end, formatSyntaxKind(handle.kind), name) : undefined
  }

  function importedDeclarations(file: string, pos: number, end: number, kindName: string): readonly TsgoNativeDeclaration[] {
    const found = node(file, pos, end, kindName)
    if (!found || !isImportSpecifier(found)) return []
    const importDeclaration = nearestNativeImportDeclaration(found)
    const moduleSpecifier = importDeclaration?.moduleSpecifier
    if (!moduleSpecifier || !isStringLiteral(moduleSpecifier)) return []
    const importedSource = moduleSourceFile(file, moduleSpecifier.text)
    if (!importedSource) return []
    return exportedDeclarations(importedSource, nativeModuleExportNameText(found.propertyName) ?? found.name.text)
  }

  function sourceDeclarations(file: string, name: string, pos?: number): readonly TsgoNativeDeclaration[] {
    const parsed = sourceFile(file)
    if (!parsed) return []
    const local = nativeLocalDeclarations(parsed, name, pos)
    if (local.length > 0) return local
    return importedDeclarationsByName(parsed, name)
  }

  function moduleSourceFile(importingFile: string, moduleSpecifier: string): SourceFile | undefined {
    if (!moduleSpecifier.startsWith('.')) return undefined
    for (const candidate of tsgoNativeModuleCandidates(resolve(dirname(importingFile), moduleSpecifier))) {
      const importedSource = sourceFile(candidate)
      if (importedSource) return importedSource
    }
    return undefined
  }

  function node(file: string, pos: number, end: number, kindName: string): Node | undefined {
    const parsed = sourceFile(file)
    if (!parsed) return undefined
    const index = indexFor(parsed.fileName, parsed)
    return index.byKey.get(nodeRangeKey(parsed.fileName, pos, end, kindName)) ?? index.byRange.get(nodeRangeFallbackKey(pos, end))
  }

  function indexFor(file: string, parsed: SourceFile): NodeRangeIndex<Node> {
    const existing = indexCache.get(file)
    if (existing) return existing
    const index = createNodeRangeIndex<Node>(
      file,
      parsed,
      (entry) => formatSyntaxKind(entry.kind),
      (entry, visit) => entry.forEachChild(visit),
    )
    indexCache.set(file, index)
    return index
  }

  function importedDeclarationsByName(source: SourceFile, name: string): readonly TsgoNativeDeclaration[] {
    for (const statement of nativeNodeList(source.statements)) {
      if (!isImportDeclaration(statement) || !statement.importClause || !isStringLiteral(statement.moduleSpecifier)) continue
      const namedBindings = statement.importClause.namedBindings
      if (!namedBindings || !isNamedImports(namedBindings)) continue
      for (const specifier of nativeNodeList(namedBindings.elements)) {
        if (specifier.name.text !== name) continue
        const importedName = nativeModuleExportNameText(specifier.propertyName) ?? specifier.name.text
        const importedSource = moduleSourceFile(source.fileName, statement.moduleSpecifier.text)
        return importedSource ? exportedDeclarations(importedSource, importedName) : []
      }
    }
    return []
  }

  function exportedDeclarations(source: SourceFile, exportedName: string): readonly TsgoNativeDeclaration[] {
    const direct = nativeTopLevelDeclarations(source, exportedName, true)
    if (direct.length > 0) return direct
    for (const statement of nativeNodeList(source.statements)) {
      if (!isExportDeclaration(statement) || !statement.exportClause || !isNamedExports(statement.exportClause)) continue
      for (const specifier of nativeNodeList(statement.exportClause.elements)) {
        if (nativeModuleExportNameText(specifier.name) !== exportedName) continue
        const localName = nativeModuleExportNameText(specifier.propertyName) ?? nativeModuleExportNameText(specifier.name)
        if (!localName) continue
        if (!statement.moduleSpecifier) return nativeTopLevelDeclarations(source, localName, false)
        if (!isStringLiteral(statement.moduleSpecifier)) continue
        const reexportSource = moduleSourceFile(source.fileName, statement.moduleSpecifier.text)
        return reexportSource ? exportedDeclarations(reexportSource, localName) : []
      }
    }
    return []
  }
}
