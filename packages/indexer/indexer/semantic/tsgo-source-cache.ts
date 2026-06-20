import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { createSourceFile } from '../ast/parse'
import type { SemanticCompilerSourceFile } from './compiler-view'
import { createNodeRangeIndex, nodeRangeFallbackKey, nodeRangeKey, type NodeRangeIndex } from './node-range-index'
import {
  exportedDeclarations,
  importedDeclarationsByName,
  isDeclarationNode,
  localDeclarations,
  nearestImportDeclaration,
  nearestNamedDeclaration,
  tsgoModuleCandidates,
} from './tsgo-source-declarations'

/** TypeScript AST cache used by the tsgo adapter for analyzer traversal. */
export interface TsgoTypeScriptSourceCache {
  /** Return cached source files for analyzer candidate discovery. */
  readonly sourceFiles: (files: readonly string[]) => readonly (ts.SourceFile & SemanticCompilerSourceFile)[]
  /** Return one cached source file, parsing it on first access. */
  readonly sourceFile: (file: string) => (ts.SourceFile & SemanticCompilerSourceFile) | undefined
  /** Return a TypeScript AST node by source range and syntax kind name. */
  readonly node: (file: string, pos: number, end: number, kindName: string) => ts.Node | undefined
  /** Return a declaration node by source range and syntax kind name. */
  readonly declaration: (
    file: string,
    pos: number,
    end: number,
    kindName: string,
    name?: string,
  ) => ts.Declaration | undefined
  /** Resolve declarations represented by an import specifier range. */
  readonly importedDeclarations: (file: string, pos: number, end: number, kindName: string) => readonly ts.Declaration[]
  /** Resolve local or imported declarations represented by an identifier name. */
  readonly sourceDeclarations: (file: string, name: string, pos?: number) => readonly ts.Declaration[]
  /** Resolve a relative module specifier from an importing file. */
  readonly moduleSourceFile: (importingFile: string, moduleSpecifier: string) => ts.SourceFile | undefined
}

/** Creates the TypeScript AST cache used by the tsgo adapter. */
export function createTsgoTypeScriptSourceCache(files: readonly string[]): TsgoTypeScriptSourceCache {
  const sourceFileCache = new Map<string, ts.SourceFile | undefined>()
  const indexCache = new Map<string, NodeRangeIndex<ts.Node>>()
  const cache: TsgoTypeScriptSourceCache = {
    sourceFiles,
    sourceFile,
    node,
    declaration,
    importedDeclarations,
    sourceDeclarations,
    moduleSourceFile,
  }

  for (const file of files) {
    sourceFile(file)
  }

  return cache

  function sourceFiles(selectedFiles: readonly string[]): readonly (ts.SourceFile & SemanticCompilerSourceFile)[] {
    return selectedFiles.flatMap((file) => sourceFile(file) ?? [])
  }

  function sourceFile(file: string): (ts.SourceFile & SemanticCompilerSourceFile) | undefined {
    const resolved = resolve(file)
    if (sourceFileCache.has(resolved)) {
      return sourceFileCache.get(resolved) as (ts.SourceFile & SemanticCompilerSourceFile) | undefined
    }
    if (!existsSync(resolved)) {
      sourceFileCache.set(resolved, undefined)
      return undefined
    }
    const parsed = createSourceFile(resolved, readFileSync(resolved, 'utf8'))
    sourceFileCache.set(resolved, parsed)
    return parsed as ts.SourceFile & SemanticCompilerSourceFile
  }

  function node(file: string, pos: number, end: number, kindName: string): ts.Node | undefined {
    const parsed = sourceFile(file)
    if (!parsed) return undefined
    const index = indexFor(parsed.fileName, parsed)
    return (
      index.byKey.get(nodeRangeKey(parsed.fileName, pos, end, kindName)) ??
      index.byRange.get(nodeRangeFallbackKey(pos, end))
    )
  }

  function declaration(
    file: string,
    pos: number,
    end: number,
    kindName: string,
    name?: string,
  ): ts.Declaration | undefined {
    const found = node(file, pos, end, kindName)
    if (found && isDeclarationNode(found)) return found
    const parsed = sourceFile(file)
    return name && parsed ? nearestNamedDeclaration(parsed, pos, end, kindName, name) : undefined
  }

  function importedDeclarations(file: string, pos: number, end: number, kindName: string): readonly ts.Declaration[] {
    const found = node(file, pos, end, kindName)
    if (!found || !ts.isImportSpecifier(found)) return []
    const importDeclaration = nearestImportDeclaration(found)
    const moduleSpecifier = importDeclaration?.moduleSpecifier
    if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) return []
    const importedSource = moduleSourceFile(file, moduleSpecifier.text)
    if (!importedSource) return []
    const exportedName = found.propertyName?.text ?? found.name.text
    return exportedDeclarations(importedSource, exportedName, cache)
  }

  function sourceDeclarations(file: string, name: string, pos?: number): readonly ts.Declaration[] {
    const parsed = sourceFile(file)
    if (!parsed) return []
    const local = localDeclarations(parsed, name, pos)
    if (local.length > 0) return local
    return importedDeclarationsByName(parsed, name, cache)
  }

  function moduleSourceFile(importingFile: string, moduleSpecifier: string): ts.SourceFile | undefined {
    if (!moduleSpecifier.startsWith('.')) return undefined
    for (const candidate of tsgoModuleCandidates(resolve(dirname(importingFile), moduleSpecifier))) {
      const importedSource = sourceFile(candidate)
      if (importedSource) return importedSource
    }
    return undefined
  }

  function indexFor(file: string, parsed: ts.SourceFile): NodeRangeIndex<ts.Node> {
    const existing = indexCache.get(file)
    if (existing) return existing
    const index = createNodeRangeIndex<ts.Node>(
      file,
      parsed,
      (node) => tsKindName(node.kind),
      (node, visit) => ts.forEachChild(node, visit),
    )
    indexCache.set(file, index)
    return index
  }
}

function tsKindName(kind: ts.SyntaxKind): string {
  return ts.SyntaxKind[kind] ?? String(kind)
}
