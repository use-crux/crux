import ts from 'typescript'
import type { ProjectRelation } from '@crux/core/project-index'
import { stringProperty } from '../../ast/literals'
import { sourceForNode } from '../../ast/snippets'
import { safeId } from '../../definitions'
import { projectRelation } from '../../relations/registry'
import type { SemanticDefinitionCandidate, SemanticResolvedSource, SemanticTarget } from '../candidates'
import { semanticObjectExpression, objectMemberExpression, semanticFallbackOptions } from './object-readers'
import {
  callExpressionName,
  isResolvableSourceExpression,
  resolveSemanticExpression,
  semanticResolvedKey,
  symbolNameForDeclaration,
  unwrapExpression,
} from './source-refs'

/** Returns whether an AST node is a callable/function-like declaration. */
export function semanticIsFunctionLike(
  node: ts.Node,
): node is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  )
}

/**
 * Creates a resolved semantic relation anchored to the candidate object source.
 *
 * This helper is pure over its inputs and delegates stable id construction to
 * the shared relation registry.
 */
export function semanticRelation(
  candidate: SemanticDefinitionCandidate,
  type: string,
  from: string,
  to: string,
): ProjectRelation {
  return projectRelation({
    type,
    from,
    to,
    fidelity: 'resolved',
    source: sourceForNode(candidate.object.getSourceFile(), candidate.object),
  })
}

/**
 * Resolves all tool targets represented by a tool map expression.
 *
 * Spread properties are followed recursively and results are deduplicated by
 * target kind/id so callers receive a stable target list.
 */
export function semanticToolMapTargets(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<string>(),
): SemanticTarget[] {
  const object = semanticObjectExpression(expression, checker, seen)
  if (!object) {
    const target = semanticTargetForExpression(expression, checker, seen)
    return target?.kind === 'tool' ? [target] : []
  }
  const targets: SemanticTarget[] = []
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      targets.push(...semanticToolMapTargets(property.expression, checker, seen))
      continue
    }
    const member = objectMemberExpression(property)
    if (!member) continue
    const target = semanticTargetForExpression(member, checker, seen)
    if (target?.kind === 'tool') targets.push(target)
  }
  return dedupeTargets(targets)
}

/**
 * Resolves an expression to the Project Index definition it represents.
 *
 * Direct call/new expressions are interpreted first; identifiers and property
 * accesses are followed through the TypeScript checker with cycle protection.
 */
export function semanticTargetForExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<string>(),
): SemanticTarget | undefined {
  const unwrapped = unwrapExpression(expression)
  const direct = semanticTargetForDefinitionExpression(unwrapped, expressionSymbolName(unwrapped))
  if (direct) return direct

  if (!isResolvableSourceExpression(unwrapped)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, checker)
  if (!resolved) return undefined
  return semanticTargetForResolved(resolved, checker, seen)
}

/**
 * Resolves a target through a source declaration while preventing cycles across
 * declaration references.
 */
function semanticTargetForResolved(
  resolved: SemanticResolvedSource,
  checker: ts.TypeChecker,
  seen: Set<string>,
): SemanticTarget | undefined {
  if (!resolved.expression) return undefined
  const key = semanticResolvedKey(resolved)
  if (seen.has(key)) return undefined
  const nextSeen = new Set(seen)
  nextSeen.add(key)
  const expression = unwrapExpression(resolved.expression)
  return (
    semanticTargetForDefinitionExpression(
      expression,
      symbolNameForDeclaration(resolved.declaration) ?? resolved.symbol,
    ) ?? semanticTargetForExpression(expression, checker, nextSeen)
  )
}

/**
 * Interprets direct call/new expressions as Project Index target definitions.
 */
function semanticTargetForDefinitionExpression(
  expression: ts.Expression,
  variableName: string | undefined,
): SemanticTarget | undefined {
  if (ts.isCallExpression(expression)) {
    const callName = callExpressionName(expression)
    if (callName === 'fallback') {
      const target = semanticFallbackTarget(expression, variableName)
      if (target) return target
    }
    const firstArg = expression.arguments[0]
    const object = firstArg && ts.isObjectLiteralExpression(firstArg) ? firstArg : undefined
    if (object) {
      const target = semanticDefinitionTargetForCall(callName, object, variableName)
      if (target) return target
    }
    if (callName === 'retriever') {
      const name = object ? stringProperty(object, 'id') : undefined
      return { id: `rag.retriever:${safeId(name ?? variableName ?? 'anonymous')}`, kind: 'rag.retriever' }
    }
    if (callName === 'retrievalPipeline') {
      return { id: `rag.pipeline:${safeId(variableName ?? 'anonymous')}`, kind: 'rag.pipeline' }
    }
    if (callName === 'scorer' || callName === 'llmJudge') {
      const name = object ? (stringProperty(object, 'id') ?? stringProperty(object, 'name')) : undefined
      return { id: `scorer:${safeId(name ?? variableName ?? 'anonymous')}`, kind: 'scorer' }
    }
    if (callName === 'evaluation') {
      const name = object ? stringProperty(object, 'name') : undefined
      return { id: `eval.prompt:${safeId(name ?? variableName ?? 'anonymous')}`, kind: 'eval.prompt' }
    }
    if (callName === 'flowEvaluation') {
      const name = object ? stringProperty(object, 'name') : undefined
      return { id: `eval.flow:${safeId(name ?? variableName ?? 'anonymous')}`, kind: 'eval.flow' }
    }
    if (callName === 'ragEvaluation') {
      const name = object ? (stringProperty(object, 'id') ?? stringProperty(object, 'name')) : undefined
      return { id: `eval.rag:${safeId(name ?? variableName ?? 'anonymous')}`, kind: 'eval.rag' }
    }
  }
  if (ts.isNewExpression(expression) && callExpressionName(expression) === 'Agent') {
    const object = expression.arguments?.find((arg): arg is ts.ObjectLiteralExpression =>
      ts.isObjectLiteralExpression(arg),
    )
    if (!object) return undefined
    const name = stringProperty(object, 'id') ?? stringProperty(object, 'name') ?? variableName ?? 'anonymous'
    return { id: `agent:${safeId(name)}`, kind: 'agent' }
  }
  return undefined
}

/**
 * Maps known factory call names and config object values to target ids/kinds.
 */
function semanticDefinitionTargetForCall(
  callName: string | undefined,
  object: ts.ObjectLiteralExpression,
  variableName: string | undefined,
): SemanticTarget | undefined {
  switch (callName) {
    case 'prompt': {
      const name = stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { id: `prompt:${safeId(name)}`, kind: 'prompt' }
    }
    case 'context': {
      const name = stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { id: `context:${safeId(name)}`, kind: 'context' }
    }
    case 'tool':
    case 'createTool': {
      const name = stringProperty(object, 'name') ?? stringProperty(object, 'title') ?? variableName ?? 'anonymous'
      return { id: `tool:${safeId(name)}`, kind: 'tool' }
    }
    case 'agent':
    case 'convexAgent': {
      const name = stringProperty(object, 'id') ?? stringProperty(object, 'name') ?? variableName ?? 'anonymous'
      return { id: `agent:${safeId(name)}`, kind: 'agent' }
    }
    case 'memory': {
      const name = stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { id: `memory:${safeId(name)}`, kind: 'memory' }
    }
    case 'blackboard': {
      const name = stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { id: `blackboard:${safeId(name)}`, kind: 'blackboard' }
    }
    case 'workspace': {
      const name = stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { id: `workspace:${safeId(name)}`, kind: 'workspace' }
    }
    case 'flow':
    case 'cruxFlow': {
      const name = stringProperty(object, 'name') ?? variableName ?? 'anonymous'
      return { id: `flow:${safeId(name)}`, kind: 'flow' }
    }
    case 'parallel':
      return { id: `composition.parallel:${safeId(variableName ?? 'anonymous')}`, kind: 'composition.parallel' }
    case 'pipeline':
      return { id: `composition.pipeline:${safeId(variableName ?? 'anonymous')}`, kind: 'composition.pipeline' }
    case 'swarm':
      return { id: `composition.swarm:${safeId(variableName ?? 'anonymous')}`, kind: 'composition.swarm' }
    case 'consensus':
      return { id: `composition.consensus:${safeId(variableName ?? 'anonymous')}`, kind: 'composition.consensus' }
    case 'router': {
      const name = stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { id: `routing.router:${safeId(name)}`, kind: 'routing.router' }
    }
    case 'cascade': {
      const name = stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { id: `routing.cascade:${safeId(name)}`, kind: 'routing.cascade' }
    }
    default:
      return undefined
  }
}

/**
 * Builds the routing fallback target represented by a `fallback(...)` call.
 */
function semanticFallbackTarget(call: ts.CallExpression, variableName: string | undefined): SemanticTarget | undefined {
  const options = semanticFallbackOptions(call)
  const name = (options ? stringProperty(options, 'id') : undefined) ?? variableName
  return name ? { id: `routing.fallback:${safeId(name)}`, kind: 'routing.fallback' } : undefined
}

/**
 * Returns the direct identifier name for target inference.
 */
function expressionSymbolName(expression: ts.Expression): string | undefined {
  return ts.isIdentifier(expression) ? expression.text : undefined
}

/**
 * Deduplicates resolved targets while preserving first-seen order.
 */
function dedupeTargets(targets: readonly SemanticTarget[]): SemanticTarget[] {
  const merged = new Map<string, SemanticTarget>()
  for (const target of targets) merged.set(`${target.kind}:${target.id}`, target)
  return [...merged.values()]
}
