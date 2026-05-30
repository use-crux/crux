import ts from 'typescript'
import type { SourceLocation } from '@crux/core/catalog'
import { sourceForNode } from '../ast/snippets'
import { resolveIdentifierSourceNode } from '../ast/source-refs'

export interface PrimitiveDataAccessRef {
  readonly kind: 'read' | 'write'
  readonly targetVariable: string
  readonly key?: string
  readonly source?: SourceLocation
}

export function primitiveDataAccessRefs(node: ts.Node, sourceFile: ts.SourceFile): PrimitiveDataAccessRef[] {
  return primitiveDataAccessRefsForNode(node, sourceFile)
}

export function primitiveDataAccessRefsWithHelpers(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  options: {
    readonly root: string
    readonly file: string
    readonly localInitializers: ReadonlyMap<string, ts.Expression>
    readonly maxDepth?: number
  },
): PrimitiveDataAccessRef[] {
  const refs = primitiveDataAccessRefsForNode(node, sourceFile)
  collectHelperDataAccessRefs(node, sourceFile, options, refs, new Set<string>(), options.maxDepth ?? 1)
  return refs
}

function primitiveDataAccessRefsForNode(node: ts.Node, sourceFile: ts.SourceFile): PrimitiveDataAccessRef[] {
  const refs: PrimitiveDataAccessRef[] = []
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)) {
      const target = child.expression.expression
      const method = child.expression.name.text
      const kind = dataAccessKind(method)
      if (kind && ts.isIdentifier(target)) {
        const key = dataAccessKey(child.arguments[0])
        refs.push({
          kind,
          targetVariable: target.text,
          ...(key ? { key } : {}),
          source: sourceForNode(sourceFile, child),
        })
      }
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return refs
}

function collectHelperDataAccessRefs(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  options: {
    readonly root: string
    readonly file: string
    readonly localInitializers: ReadonlyMap<string, ts.Expression>
  },
  refs: PrimitiveDataAccessRef[],
  seen: Set<string>,
  depth: number,
): void {
  if (depth <= 0) return
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
      const symbol = child.expression.text
      if (!seen.has(symbol)) {
        seen.add(symbol)
        const resolved = resolveIdentifierSourceNode(options.root, options.file, sourceFile, symbol, options.localInitializers)
        if (resolved) {
          refs.push(...primitiveDataAccessRefsForNode(resolved.node, resolved.sourceFile))
          collectHelperDataAccessRefs(resolved.node, resolved.sourceFile, {
            root: options.root,
            file: resolved.sourceFile.fileName,
            localInitializers: resolved.localInitializers,
          }, refs, seen, depth - 1)
        }
      }
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
}

export function primitiveDataIntelligence(accesses: readonly PrimitiveDataAccessRef[]): Record<string, unknown> | undefined {
  if (accesses.length === 0) return undefined
  const reads = accesses.filter((access) => access.kind === 'read').map(accessToMetadata)
  const writes = accesses.filter((access) => access.kind === 'write').map(accessToMetadata)
  return {
    confidence: 'static',
    data: {
      ...(reads.length > 0 ? { reads } : {}),
      ...(writes.length > 0 ? { writes } : {}),
    },
  }
}

function accessToMetadata(access: PrimitiveDataAccessRef): Record<string, unknown> {
  return {
    targetVariable: access.targetVariable,
    ...(access.key ? { key: access.key } : {}),
    ...(access.source ? { source: access.source } : {}),
  }
}

function dataAccessKind(method: string): 'read' | 'write' | undefined {
  if (['get', 'read', 'query', 'find', 'search', 'list', 'readFile', 'load'].includes(method)) return 'read'
  if (['set', 'write', 'update', 'append', 'delete', 'put', 'writeFile', 'edit', 'deleteFile', 'save'].includes(method)) return 'write'
  return undefined
}

function dataAccessKey(expression: ts.Expression | undefined): string | undefined {
  if (!expression) return undefined
  if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)) return expression.text
  return undefined
}
