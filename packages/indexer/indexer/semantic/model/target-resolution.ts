import type { ProjectRelation } from '@crux/core/project-index'
import { safeId } from '../../definitions'
import { projectRelation } from '../../relations'
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
  SemanticResolvedSource,
  SemanticTarget,
} from '../candidates'
import { semanticSourceForNode, semanticStringLiteralProperty } from '../syntax-readers'
import { objectMemberExpression, semanticFallbackOptions, semanticObjectExpression } from './object-readers'
import {
  callExpressionName,
  isResolvableSourceExpression,
  resolveSemanticExpression,
  semanticResolvedKey,
  symbolNameForDeclaration,
  unwrapExpression,
} from './source-refs'

/** Returns whether a backend-owned syntax node is function-like. */
export function semanticIsFunctionLike(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): boolean {
  return view.syntax.isFunctionLike(node)
}

/**
 * Creates a resolved semantic relation anchored to the candidate object source.
 */
export function semanticRelation(
  candidate: SemanticDefinitionCandidate,
  type: string,
  from: string,
  to: string,
  view: SemanticAnalyzerView,
): ProjectRelation {
  return projectRelation({
    type,
    from,
    to,
    fidelity: 'resolved',
    source: semanticSourceForNode(candidate.object, view.syntax),
  })
}

/** Resolves all tool targets represented by a tool map expression. */
export function semanticToolMapTargets(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen = new Set<string>(),
): SemanticTarget[] {
  const object = semanticObjectExpression(expression, view, seen)
  if (!object) {
    const target = semanticTargetForExpression(expression, view, seen)
    return target?.kind === 'tool' ? [target] : []
  }
  const targets: SemanticTarget[] = []
  for (const property of view.syntax.objectProperties(object)) {
    const spread = view.syntax.spreadExpression(property)
    if (spread) {
      targets.push(...semanticToolMapTargets(spread, view, seen))
      continue
    }
    const member = objectMemberExpression(property, view)
    if (!member) continue
    const target = semanticTargetForExpression(member, view, seen)
    if (target?.kind === 'tool') targets.push(target)
  }
  return dedupeTargets(targets)
}

/** Resolves an expression to the Project Index definition it represents. */
export function semanticTargetForExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen = new Set<string>(),
): SemanticTarget | undefined {
  const unwrapped = unwrapExpression(expression, view)
  const direct = semanticTargetForDefinitionExpression(unwrapped, expressionSymbolName(unwrapped, view), view)
  if (direct) return direct

  if (!isResolvableSourceExpression(unwrapped, view)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, view)
  if (!resolved) return undefined
  return semanticTargetForResolved(resolved, view, seen)
}

function semanticTargetForResolved(
  resolved: SemanticResolvedSource,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): SemanticTarget | undefined {
  if (!resolved.expression) return undefined
  const key = semanticResolvedKey(resolved)
  if (seen.has(key)) return undefined
  const nextSeen = new Set(seen)
  nextSeen.add(key)
  const expression = unwrapExpression(resolved.expression, view)
  return (
    semanticTargetForDefinitionExpression(
      expression,
      symbolNameForDeclaration(resolved.declaration, view) ?? resolved.symbol,
      view,
    ) ?? semanticTargetForExpression(expression, view, nextSeen)
  )
}

function semanticTargetForDefinitionExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  variableName: string | undefined,
  view: SemanticAnalyzerView,
): SemanticTarget | undefined {
  if (view.syntax.isKind(expression, 'callExpression')) {
    const callName = callExpressionName(expression, view)
    if (callName === 'fallback') {
      const target = semanticFallbackTarget(expression, variableName, view)
      if (target) return target
    }
    const [firstArg] = view.syntax.callArguments(expression)
    const object = firstArg && view.syntax.isKind(firstArg, 'objectLiteral') ? firstArg : undefined
    if (object) {
      const target = semanticDefinitionTargetForCall(callName, object, variableName, view)
      if (target) return target
    }
    if (callName === 'retriever') {
      const name = object ? semanticStringLiteralProperty(object, 'id', view.syntax) : undefined
      return { id: `rag.retriever:${safeId(name ?? variableName ?? 'anonymous')}`, kind: 'rag.retriever' }
    }
    if (callName === 'retrievalPipeline') {
      return { id: `rag.pipeline:${safeId(variableName ?? 'anonymous')}`, kind: 'rag.pipeline' }
    }
    if (callName === 'scorer' || callName === 'llmJudge') {
      const name = object
        ? (semanticStringLiteralProperty(object, 'id', view.syntax) ??
          semanticStringLiteralProperty(object, 'name', view.syntax))
        : undefined
      return { id: `scorer:${safeId(name ?? variableName ?? 'anonymous')}`, kind: 'scorer' }
    }
    if (callName === 'evaluate') {
      const explicitId = firstArg ? view.syntax.stringLiteralText(firstArg) : undefined
      return { id: `evaluation:${safeId(explicitId ?? variableName ?? 'anonymous')}`, kind: 'evaluation' }
    }
  }
  if (view.syntax.isKind(expression, 'newExpression') && callExpressionName(expression, view) === 'Agent') {
    const object = view.syntax.newArguments(expression).find((arg) => view.syntax.isKind(arg, 'objectLiteral'))
    if (!object) return undefined
    const name =
      semanticStringLiteralProperty(object, 'id', view.syntax) ??
      semanticStringLiteralProperty(object, 'name', view.syntax) ??
      variableName ??
      'anonymous'
    return { id: `agent:${safeId(name)}`, kind: 'agent' }
  }
  return undefined
}

function semanticDefinitionTargetForCall(
  callName: string | undefined,
  object: SemanticAnalyzerNode<SemanticAnalyzerView>,
  variableName: string | undefined,
  view: SemanticAnalyzerView,
): SemanticTarget | undefined {
  switch (callName) {
    case 'prompt':
      return target('prompt', semanticStringLiteralProperty(object, 'id', view.syntax) ?? variableName)
    case 'context':
      return target('context', semanticStringLiteralProperty(object, 'id', view.syntax) ?? variableName)
    case 'injectable':
      return target('injectable', semanticStringLiteralProperty(object, 'id', view.syntax) ?? variableName)
    case 'tool':
    case 'createTool': {
      const name =
        semanticStringLiteralProperty(object, 'name', view.syntax) ??
        semanticStringLiteralProperty(object, 'title', view.syntax) ??
        variableName
      return target('tool', name)
    }
    case 'agent':
    case 'convexAgent':
      return target(
        'agent',
        semanticStringLiteralProperty(object, 'id', view.syntax) ??
          semanticStringLiteralProperty(object, 'name', view.syntax) ??
          variableName,
      )
    case 'memory':
      return target('memory', semanticStringLiteralProperty(object, 'id', view.syntax) ?? variableName)
    case 'blackboard':
      return target('blackboard', semanticStringLiteralProperty(object, 'id', view.syntax) ?? variableName)
    case 'workspace':
      return target('workspace', semanticStringLiteralProperty(object, 'id', view.syntax) ?? variableName)
    case 'flow':
    case 'cruxFlow':
      return target('flow', semanticStringLiteralProperty(object, 'name', view.syntax) ?? variableName)
    case 'parallel':
      return target('composition.parallel', variableName)
    case 'pipeline':
      return target('composition.pipeline', variableName)
    case 'swarm':
      return target('composition.swarm', variableName)
    case 'consensus':
      return target('composition.consensus', variableName)
    case 'router':
      return target('routing.router', semanticStringLiteralProperty(object, 'id', view.syntax) ?? variableName)
    case 'cascade':
      return target('routing.cascade', semanticStringLiteralProperty(object, 'id', view.syntax) ?? variableName)
    default:
      return undefined
  }
}

function semanticFallbackTarget(
  call: SemanticAnalyzerNode<SemanticAnalyzerView>,
  variableName: string | undefined,
  view: SemanticAnalyzerView,
): SemanticTarget | undefined {
  const options = semanticFallbackOptions(call, view)
  const name = (options ? semanticStringLiteralProperty(options, 'id', view.syntax) : undefined) ?? variableName
  return name ? { id: `routing.fallback:${safeId(name)}`, kind: 'routing.fallback' } : undefined
}

function expressionSymbolName(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): string | undefined {
  return view.syntax.identifierText(expression)
}

function target(kind: SemanticTarget['kind'], name: string | undefined): SemanticTarget {
  return { id: `${kind}:${safeId(name ?? 'anonymous')}`, kind }
}

function dedupeTargets(targets: readonly SemanticTarget[]): SemanticTarget[] {
  const merged = new Map<string, SemanticTarget>()
  for (const target of targets) merged.set(`${target.kind}:${target.id}`, target)
  return [...merged.values()]
}
