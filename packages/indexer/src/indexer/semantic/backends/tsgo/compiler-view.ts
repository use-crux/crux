/**
 * Native TypeScript-Go semantic compiler view.
 *
 * The view keeps native-preview checker handles inside the tsgo backend while
 * exposing Crux's backend-neutral compiler and syntax contracts to shared
 * semantic analyzers. Native runs operate on native-preview AST nodes directly;
 * they do not create or map through JavaScript TypeScript `SourceFile` objects.
 *
 * @module
 */

import {
  isIdentifier,
  isImportDeclaration,
  isNamespaceImport,
  isPropertyAccessExpression,
  isShorthandPropertyAssignment,
  type Identifier as TsgoIdentifier,
  type Node as TsgoNode,
  type SourceFile as TsgoSourceFile,
} from '@typescript/native-preview/unstable/ast'
import { formatSyntaxKind } from '@typescript/native-preview/unstable/ast/utils'
import { type Project, type Symbol as TsgoSymbol, type Type as TsgoType } from '@typescript/native-preview/unstable/sync'
import type { SemanticCompilerSourceFile, SemanticCompilerView } from '../../compiler-view'
import type { SemanticBackendIdentity } from '../../service/types'
import { nativeNodeList } from './source'
import type { TsgoNativeDeclaration } from './native-source-declarations'
import type { TsgoNativeSourceLookup } from './source-lookup'
import { createTsgoSemanticSyntaxView } from './syntax-view'

type TsgoSemanticCompilerSourceFile = TsgoSourceFile & SemanticCompilerSourceFile

interface TsgoResolvedDeclarationSymbol {
  readonly kind: 'resolved-declarations'
  readonly name: string
  readonly declarations: readonly TsgoNativeDeclaration[]
}

type TsgoSemanticSymbol = TsgoSymbol | TsgoResolvedDeclarationSymbol

export type TsgoSemanticCompilerView = SemanticCompilerView<
  TsgoNode,
  TsgoSemanticCompilerSourceFile,
  TsgoNativeDeclaration,
  TsgoSemanticSymbol,
  TsgoType
>

/**
 * Creates a Crux semantic compiler view backed by one TypeScript-Go project.
 *
 * Structural traversal, source text, symbol lookup, and declaration mapping all
 * use native-preview APIs. Import and local-source declaration fallbacks are
 * provided by `TsgoNativeSourceLookup`, which resolves native declaration nodes
 * without parsing files through the JavaScript TypeScript compiler.
 */
export function createTsgoCompilerView(
  identity: SemanticBackendIdentity,
  project: Project,
  sourceLookup: TsgoNativeSourceLookup,
): TsgoSemanticCompilerView {
  const symbolAtCache = new Map<string, TsgoSymbol | undefined>()
  const resolvedSymbolCache = new Map<string, TsgoSemanticSymbol | undefined>()
  const shorthandSymbolCache = new Map<string, TsgoSymbol | undefined>()
  const typeCache = new Map<string, TsgoType | undefined>()
  const declarationsCache = new Map<string, readonly TsgoNativeDeclaration[]>()
  const syntax = createTsgoSemanticSyntaxView({
    sourceFiles: sourceLookup.sourceFiles,
  })

  return {
    identity,
    syntax,
    sourceFiles(files) {
      return syntax.sourceFiles(files)
    },
    sourceFile(node) {
      return syntax.sourceFile(node)
    },
    sourceText(node) {
      return syntax.text(node)
    },
    childNodes(node) {
      return syntax.children(node)
    },
    symbolsAt(nodes) {
      return cachedNativeResults(nodes, symbolAtCache, (nativeNodes) =>
        project.checker.getSymbolAtLocation(nativeNodes),
      )
    },
    resolvedSymbols(nodes) {
      return nodes.map((node) =>
        cached(resolvedSymbolCache, nativeNodeKey(node), () => {
          const symbol = cachedShorthandAssignmentValueSymbol(project, node, shorthandSymbolCache) ?? resolvedSymbol(project, node)
          if (isIdentifier(node) && isPropertyAccessName(node)) {
            return symbol && isUsablePropertyAccessSymbol(node, symbol) ? symbol : undefined
          }
          return (symbol ? sourceImportAlias(sourceLookup, symbol) : undefined) ?? sourceIdentifierSymbol(sourceLookup, node) ?? symbol
        }),
      )
    },
    shorthandAssignmentValueSymbols(nodes) {
      return nodes.map((node) => cachedShorthandAssignmentValueSymbol(project, node, shorthandSymbolCache))
    },
    typesAt(nodes) {
      return cachedNativeResults(nodes, typeCache, (nativeNodes) => project.checker.getTypeAtLocation(nativeNodes))
    },
    typeStrings(types, enclosing) {
      return types.map((type) => project.checker.typeToString(type, enclosing))
    },
    declarationsOf(symbols) {
      return symbols.map((symbol) =>
        isResolvedDeclarationSymbol(symbol)
          ? symbol.declarations
          : cached(declarationsCache, String(symbol.id), () => sourceLookup.declarationsForSymbol(symbol)),
      )
    },
  }
}

function cachedNativeResults<TValue>(
  nodes: readonly TsgoNode[],
  cache: Map<string, TValue | undefined>,
  read: (nativeNodes: readonly TsgoNode[]) => readonly (TValue | undefined)[],
): readonly (TValue | undefined)[] {
  const results: (TValue | undefined)[] = []
  const pendingNodes: TsgoNode[] = []
  const pendingIndexes: number[] = []

  nodes.forEach((node, index) => {
    const key = nativeNodeKey(node)
    if (cache.has(key)) {
      results[index] = cache.get(key)
      return
    }
    pendingIndexes.push(index)
    pendingNodes.push(node)
  })

  const pendingResults = pendingNodes.length > 0 ? read(pendingNodes) : []
  pendingResults.forEach((value, offset) => {
    const index = pendingIndexes[offset]
    const key = nativeNodeKey(nodes[index] as TsgoNode)
    cache.set(key, value)
    results[index] = value
  })
  return results
}

function resolvedSymbol(project: Project, node: TsgoNode): TsgoSymbol | undefined {
  if (isIdentifier(node)) {
    return project.checker.getResolvedSymbol(node as TsgoIdentifier) ?? project.checker.getSymbolAtLocation(node)
  }
  return project.checker.getSymbolAtLocation(node)
}

function shorthandAssignmentValueSymbol(project: Project, node: TsgoNode): TsgoSymbol | undefined {
  if (!isIdentifier(node)) return undefined
  const parent = node.parent
  return parent && isShorthandPropertyAssignment(parent)
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
  sourceLookup: TsgoNativeSourceLookup,
  symbol: TsgoSymbol,
): TsgoResolvedDeclarationSymbol | undefined {
  const declarations = symbol.declarations.flatMap((handle) =>
    sourceLookup.importedDeclarations(handle.path, handle.pos, handle.end, formatSyntaxKind(handle.kind)),
  )
  return declarations.length > 0 ? { kind: 'resolved-declarations', name: symbol.name, declarations } : undefined
}

function sourceIdentifierSymbol(
  sourceLookup: TsgoNativeSourceLookup,
  node: TsgoNode,
): TsgoResolvedDeclarationSymbol | undefined {
  if (!isIdentifier(node) || isPropertyAccessName(node)) return undefined
  const declarations = sourceLookup.sourceDeclarations(node.getSourceFile().fileName, node.text, node.pos)
  return declarations.length > 0 ? { kind: 'resolved-declarations', name: node.text, declarations } : undefined
}

function isPropertyAccessName(node: TsgoIdentifier): boolean {
  const parent = node.parent
  return Boolean(parent && isPropertyAccessExpression(parent) && parent.name === node)
}

function isUsablePropertyAccessSymbol(node: TsgoIdentifier, symbol: TsgoSymbol): boolean {
  if (isNamespaceImportPropertyAccessName(node)) return true
  return symbol.declarations.some((declaration) => isPropertyLikeDeclarationKind(formatSyntaxKind(declaration.kind)))
}

function isNamespaceImportPropertyAccessName(node: TsgoIdentifier): boolean {
  const parent = node.parent
  if (!parent || !isPropertyAccessExpression(parent) || parent.name !== node || !isIdentifier(parent.expression)) return false
  const namespace = parent.expression.text
  return nativeNodeList(node.getSourceFile().statements).some(
    (statement) =>
      isImportDeclaration(statement) &&
      statement.importClause?.namedBindings &&
      isNamespaceImport(statement.importClause.namedBindings) &&
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

function isResolvedDeclarationSymbol(symbol: TsgoSemanticSymbol): symbol is TsgoResolvedDeclarationSymbol {
  return 'kind' in symbol && symbol.kind === 'resolved-declarations'
}

function nativeNodeKey(node: TsgoNode): string {
  const sourceFile = node.getSourceFile()
  return `${sourceFile.fileName}:${node.pos}:${node.end}:${formatSyntaxKind(node.kind)}`
}

function cached<K, V>(cache: Map<K, V>, key: K, create: () => V): V {
  if (cache.has(key)) return cache.get(key) as V
  const value = create()
  cache.set(key, value)
  return value
}
