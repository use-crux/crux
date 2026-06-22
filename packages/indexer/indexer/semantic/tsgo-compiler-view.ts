import { type Project, type Symbol as TsgoSymbol, type Type as TsgoType } from '@typescript/native-preview/unstable/sync'
import type { Identifier as TsgoIdentifier, Node as TsgoNode, SourceFile as TsgoSourceFile } from '@typescript/native-preview/unstable/ast'
import { formatSyntaxKind } from '@typescript/native-preview/unstable/ast/utils'
import ts from 'typescript'
import type { SemanticCompilerSourceFile, SemanticCompilerView } from './compiler-view'
import {
  createNodeRangeIndex,
  nodeRangeFallbackKey,
  nodeRangeKey,
  type NodeRangeIndex,
} from './node-range-index'
import type { SemanticBackendIdentity } from './service/types'
import type { TsgoTypeScriptSourceCache } from './tsgo-source-cache'

interface TsgoResolvedDeclarationSymbol {
  readonly kind: 'resolved-declarations'
  readonly name: string
  readonly declarations: readonly ts.Declaration[]
}

type TsgoSemanticSymbol = TsgoSymbol | TsgoResolvedDeclarationSymbol

export type TsgoSemanticCompilerView = SemanticCompilerView<
  ts.Node,
  ts.SourceFile & SemanticCompilerSourceFile,
  ts.Declaration,
  TsgoSemanticSymbol,
  TsgoType
>

/**
 * Creates a Crux semantic compiler view backed by one TypeScript-Go project.
 *
 * Crux analyzers still use TypeScript AST nodes for structural traversal. This
 * adapter maps those nodes to native-preview nodes by file, range, and syntax
 * kind before calling TypeScript-Go checker APIs.
 */
export function createTsgoCompilerView(
  identity: SemanticBackendIdentity,
  project: Project,
  sourceCache: TsgoTypeScriptSourceCache,
): TsgoSemanticCompilerView {
  const nativeNode = createNativeNodeResolver()
  const symbolAtCache = new Map<string, TsgoSymbol | undefined>()
  const resolvedSymbolCache = new Map<string, TsgoSemanticSymbol | undefined>()
  const shorthandSymbolCache = new Map<string, TsgoSymbol | undefined>()
  const typeCache = new Map<string, TsgoType | undefined>()
  const declarationsCache = new Map<string, readonly ts.Declaration[]>()

  return {
    identity,
    sourceFiles: sourceCache.sourceFiles,
    sourceFile: (node) => node.getSourceFile() as ts.SourceFile & SemanticCompilerSourceFile,
    sourceText: (node) => node.getText(),
    childNodes,
    symbolsAt(nodes) {
      return cachedNativeResults(nodes, (node) => nativeNode(project, node), symbolAtCache, (nativeNodes) =>
        project.checker.getSymbolAtLocation(nativeNodes),
      )
    },
    resolvedSymbols(nodes) {
      return nodes.map((node) =>
        cached(resolvedSymbolCache, tsNodeKey(node), () => {
          const native = nativeNode(project, node)
          const symbol = native
            ? cachedShorthandAssignmentValueSymbol(project, native, shorthandSymbolCache) ?? resolvedSymbol(project, native)
            : undefined
          if (ts.isIdentifier(node) && isPropertyAccessName(node)) {
            return symbol && isUsablePropertyAccessSymbol(node, symbol) ? symbol : undefined
          }
          return (symbol ? sourceImportAlias(sourceCache, symbol) : undefined) ?? sourceIdentifierSymbol(sourceCache, node) ?? symbol
        }),
      )
    },
    shorthandAssignmentValueSymbols(nodes) {
      return nodes.map((node) => {
        const native = nativeNode(project, node)
        return native ? cachedShorthandAssignmentValueSymbol(project, native, shorthandSymbolCache) : undefined
      })
    },
    typesAt(nodes) {
      return cachedNativeResults(nodes, (node) => nativeNode(project, node), typeCache, (nativeNodes) =>
        project.checker.getTypeAtLocation(nativeNodes),
      )
    },
    typeStrings(types, enclosing) {
      const nativeEnclosing = enclosing ? nativeNode(project, enclosing) : undefined
      return types.map((type) => project.checker.typeToString(type, nativeEnclosing))
    },
    declarationsOf(symbols) {
      return symbols.map((symbol) =>
        isResolvedDeclarationSymbol(symbol)
          ? symbol.declarations
          : cached(declarationsCache, symbol.id, () =>
              symbol.declarations
                .map((handle) =>
                  sourceCache.declaration(handle.path, handle.pos, handle.end, formatSyntaxKind(handle.kind), symbol.name),
                )
                .filter((node): node is ts.Declaration => Boolean(node)),
            ),
      )
    },
  }
}

function cachedNativeResults<TValue>(
  nodes: readonly ts.Node[],
  nativeNode: (node: ts.Node) => TsgoNode | undefined,
  cache: Map<string, TValue | undefined>,
  read: (nativeNodes: readonly TsgoNode[]) => readonly (TValue | undefined)[],
): readonly (TValue | undefined)[] {
  const results: (TValue | undefined)[] = []
  const pendingNativeNodes: TsgoNode[] = []
  const pendingIndexes: number[] = []

  nodes.forEach((node, index) => {
    const key = tsNodeKey(node)
    if (cache.has(key)) {
      results[index] = cache.get(key)
      return
    }
    const native = nativeNode(node)
    if (!native) {
      cache.set(key, undefined)
      results[index] = undefined
      return
    }
    pendingIndexes.push(index)
    pendingNativeNodes.push(native)
  })

  const pendingResults = pendingNativeNodes.length > 0 ? read(pendingNativeNodes) : []
  pendingResults.forEach((value, offset) => {
    const index = pendingIndexes[offset]
    const key = tsNodeKey(nodes[index] as ts.Node)
    cache.set(key, value)
    results[index] = value
  })
  return results
}

function childNodes(node: ts.Node): readonly ts.Node[] {
  const children: ts.Node[] = []
  ts.forEachChild(node, (child) => {
    children.push(child)
  })
  return children
}

function resolvedSymbol(project: Project, node: TsgoNode): TsgoSymbol | undefined {
  if (formatSyntaxKind(node.kind) === 'Identifier') {
    return project.checker.getResolvedSymbol(node as TsgoIdentifier) ?? project.checker.getSymbolAtLocation(node)
  }
  return project.checker.getSymbolAtLocation(node)
}

function shorthandAssignmentValueSymbol(project: Project, node: TsgoNode): TsgoSymbol | undefined {
  if (formatSyntaxKind(node.kind) !== 'Identifier') return undefined
  const parent = node.parent
  return parent && formatSyntaxKind(parent.kind) === 'ShorthandPropertyAssignment'
    ? project.checker.getShorthandAssignmentValueSymbol(parent)
    : undefined
}

function cachedShorthandAssignmentValueSymbol(
  project: Project,
  node: TsgoNode,
  cache: Map<string, TsgoSymbol | undefined>,
): TsgoSymbol | undefined {
  return cached(cache, nativeNodeKey(node), () => shorthandAssignmentValueSymbol(project, node))
}

function sourceImportAlias(
  sourceCache: TsgoTypeScriptSourceCache,
  symbol: TsgoSymbol,
): TsgoResolvedDeclarationSymbol | undefined {
  const declarations = symbol.declarations.flatMap((handle) =>
    sourceCache.importedDeclarations(handle.path, handle.pos, handle.end, formatSyntaxKind(handle.kind)),
  )
  return declarations.length > 0 ? { kind: 'resolved-declarations', name: symbol.name, declarations } : undefined
}

function sourceIdentifierSymbol(
  sourceCache: TsgoTypeScriptSourceCache,
  node: ts.Node,
): TsgoResolvedDeclarationSymbol | undefined {
  if (!ts.isIdentifier(node) || isPropertyAccessName(node)) return undefined
  const declarations = sourceCache.sourceDeclarations(node.getSourceFile().fileName, node.text, node.pos)
  return declarations.length > 0 ? { kind: 'resolved-declarations', name: node.text, declarations } : undefined
}

function isPropertyAccessName(node: ts.Identifier): boolean {
  return ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
}

function isUsablePropertyAccessSymbol(node: ts.Identifier, symbol: TsgoSymbol): boolean {
  if (isNamespaceImportPropertyAccessName(node)) return true
  return symbol.declarations.some((declaration) => isPropertyLikeDeclarationKind(formatSyntaxKind(declaration.kind)))
}

function isNamespaceImportPropertyAccessName(node: ts.Identifier): boolean {
  const parent = node.parent
  if (!ts.isPropertyAccessExpression(parent) || parent.name !== node || !ts.isIdentifier(parent.expression)) return false
  const namespace = parent.expression.text
  return node
    .getSourceFile()
    .statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        statement.importClause?.namedBindings &&
        ts.isNamespaceImport(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.name.text === namespace,
    )
}

function isPropertyLikeDeclarationKind(kind: string): boolean {
  return (
    kind === 'PropertyAssignment' ||
    kind === 'ShorthandPropertyAssignment' ||
    kind === 'MethodDeclaration' ||
    kind === 'PropertyDeclaration' ||
    kind === 'PropertySignature'
  )
}

function createNativeNodeResolver(): (project: Project, node: ts.Node) => TsgoNode | undefined {
  const indexes = new Map<string, NodeRangeIndex<TsgoNode>>()
  const sourceFiles = new Map<string, TsgoSourceFile | undefined>()
  return (project, node) => {
    const file = node.getSourceFile().fileName
    const sourceFile = cached(sourceFiles, file, () => project.program.getSourceFile(file))
    if (!sourceFile) return undefined
    const index = indexFor(indexes, file, sourceFile)
    return (
      index.byKey.get(nodeRangeKey(file, node.pos, node.end, tsKindName(node.kind))) ??
      index.byRange.get(nodeRangeFallbackKey(node.pos, node.end))
    )
  }
}

function indexFor(
  indexes: Map<string, NodeRangeIndex<TsgoNode>>,
  file: string,
  sourceFile: TsgoSourceFile,
): NodeRangeIndex<TsgoNode> {
  const existing = indexes.get(file)
  if (existing) return existing
  const index = createNodeRangeIndex<TsgoNode>(
    file,
    sourceFile,
    (node) => formatSyntaxKind(node.kind),
    (node, visit) => node.forEachChild(visit),
  )
  indexes.set(file, index)
  return index
}

function isResolvedDeclarationSymbol(symbol: TsgoSemanticSymbol): symbol is TsgoResolvedDeclarationSymbol {
  return 'kind' in symbol && symbol.kind === 'resolved-declarations'
}

function tsKindName(kind: ts.SyntaxKind): string {
  return ts.SyntaxKind[kind] ?? String(kind)
}

function tsNodeKey(node: ts.Node): string {
  const file = node.getSourceFile().fileName
  return nodeRangeKey(file, node.pos, node.end, tsKindName(node.kind))
}

function nativeNodeKey(node: TsgoNode): string {
  const sourceFile = node.getSourceFile()
  return nodeRangeKey(sourceFile.fileName, node.pos, node.end, formatSyntaxKind(node.kind))
}

function cached<K, V>(cache: Map<K, V>, key: K, create: () => V): V {
  if (cache.has(key)) return cache.get(key) as V
  const value = create()
  cache.set(key, value)
  return value
}
