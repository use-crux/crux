import ts from 'typescript'
import type { SourceLocation } from '@use-crux/core/project-index'
import { sourceForNode } from '../../../ast/snippets'
import type { StaticCallContext } from '../../../extractors/types'

export interface RuntimeUsageRef {
  readonly method: 'waitFor' | 'defer' | 'after' | 'untilIdle'
  readonly source?: SourceLocation
  readonly closureTarget?: boolean
  readonly nonSerializablePayload?: string
}

export interface NondeterministicRef {
  readonly expression: 'Date.now' | 'Math.random' | 'new Date'
  readonly source?: SourceLocation
}

export function collectRuntimeUsages(ctx: StaticCallContext, node: ts.Node): readonly RuntimeUsageRef[] {
  const current = runtimeUsageForCall(ctx, node)
  return [
    ...(current ? [current] : []),
    ...childrenOf(node).flatMap((child) => collectRuntimeUsages(ctx, child)),
  ]
}

export function collectNondeterministicCalls(ctx: StaticCallContext, node: ts.Node): readonly NondeterministicRef[] {
  if (ts.isCallExpression(node) && flowScopeCallName(node) === 'step') return []
  const current = nondeterministicRef(ctx, node)
  return [
    ...(current ? [current] : []),
    ...childrenOf(node).flatMap((child) => collectNondeterministicCalls(ctx, child)),
  ]
}

function runtimeUsageForCall(ctx: StaticCallContext, node: ts.Node): RuntimeUsageRef | undefined {
  if (!ts.isCallExpression(node)) return undefined
  const method = flowScopeCallName(node)
  if (method !== 'waitFor' && method !== 'defer' && method !== 'after' && method !== 'untilIdle') return undefined
  const payloadArg = method === 'defer' ? node.arguments[1] : method === 'after' ? node.arguments[2] : undefined
  return {
    method,
    source: sourceForNode(ctx.sourceFile, node),
    ...(method === 'defer' && isFunctionLike(node.arguments[0]) ? { closureTarget: true } : {}),
    ...(payloadArg && nonSerializableExpressionLabel(payloadArg)
      ? { nonSerializablePayload: nonSerializableExpressionLabel(payloadArg) }
      : {}),
  }
}

function nondeterministicRef(ctx: StaticCallContext, node: ts.Node): NondeterministicRef | undefined {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const receiver = node.expression.expression
    const method = node.expression.name.text
    if (ts.isIdentifier(receiver) && receiver.text === 'Date' && method === 'now') {
      return { expression: 'Date.now', source: sourceForNode(ctx.sourceFile, node) }
    }
    if (ts.isIdentifier(receiver) && receiver.text === 'Math' && method === 'random') {
      return { expression: 'Math.random', source: sourceForNode(ctx.sourceFile, node) }
    }
  }
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Date') {
    return { expression: 'new Date', source: sourceForNode(ctx.sourceFile, node) }
  }
  return undefined
}

function flowScopeCallName(call: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(call.expression)) return call.expression.text
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text
  return undefined
}

function isFunctionLike(node: ts.Node | undefined): boolean {
  return Boolean(node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)))
}

function nonSerializableExpressionLabel(node: ts.Expression): string | undefined {
  if (isFunctionLike(node)) return 'function'
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
    if (node.expression.text === 'Map' || node.expression.text === 'Set' || node.expression.text === 'WeakMap') {
      return node.expression.text
    }
  }
  return undefined
}

function childrenOf(node: ts.Node): readonly ts.Node[] {
  let children: readonly ts.Node[] = []
  ts.forEachChild(node, (child) => {
    children = [...children, child]
  })
  return children
}
