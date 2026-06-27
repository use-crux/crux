import type { ProjectDefinitionKind, ProjectRelation } from '@use-crux/core/project-index'
import { safeId } from '../definitions'
import { projectRelation } from '../relations'
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
  SemanticDefinitionKind,
  SemanticResolvedSource,
  SemanticTarget,
} from './candidates'
import {
  isEvalKind,
  isResolvableSourceExpression,
  semanticResolvedKey,
  semanticTargetForExpression,
  propertyInitializer,
  resolveSemanticExpression,
  unwrapExpression,
} from './model'
import { semanticSourceForNode } from './syntax-readers'

interface SemanticAccess {
  readonly kind: 'read' | 'write' | 'query' | 'score' | 'eval'
  readonly target: SemanticTarget
  readonly node: SemanticAnalyzerNode<SemanticAnalyzerView>
}

/**
 * Resolves resource, retriever, scorer, and eval accesses from callback-style
 * properties on a semantic definition candidate.
 */
export function semanticCallbackAccessRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  return semanticCallbackProperties(candidate.kind)
    .flatMap((property) => {
      const expression = propertyInitializer(candidate.object, property, view)
      return expression ? semanticAccessesForExpression(expression, view) : []
    })
    .flatMap((access) => semanticAccessRelation(candidate.kind, candidate.definitionId, access, view))
}

/**
 * Resolves accesses made by flow step targets and anchors the relations on the
 * corresponding folded flow-step definition id.
 */
export function semanticFlowAccessRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const handler = propertyInitializer(candidate.object, 'handler', view)
  if (!handler) return []
  const relations: ProjectRelation[] = []
  const visit = (node: SemanticAnalyzerNode<SemanticAnalyzerView>): void => {
    if (view.syntax.isKind(node, 'callExpression')) {
      const target = view.syntax.callExpressionTarget(node)
      if (target && view.syntax.propertyAccessName(target) === 'step') {
        const [stepArg, targetArg] = view.syntax.callArguments(node)
        const stepName = stepArg ? view.syntax.stringLiteralText(stepArg) : undefined
        if (stepName && targetArg) {
          const from = `flow.step:${safeId(candidate.name)}:${safeId(stepName)}`
          for (const access of semanticAccessesForExpression(targetArg, view)) {
            relations.push(...semanticAccessRelation('flow.step', from, access, view))
          }
        }
      }
    }
    view.syntax.children(node).forEach(visit)
  }
  visit(handler)
  return relations
}

/**
 * Returns callback/config properties that can contain executable access logic
 * for a definition kind.
 */
function semanticCallbackProperties(kind: SemanticDefinitionKind): string[] {
  switch (kind) {
    case 'prompt':
      return ['prompt', 'system']
    case 'context':
      return ['resolve', 'render', 'handler', 'when', 'system']
    case 'tool':
      return ['execute', 'run', 'handler']
    case 'agent':
      return ['handler', 'run', 'execute', 'contextHandler', 'usageHandler', 'prepare']
    default:
      return []
  }
}

/**
 * Resolves an expression to a scannable access root and extracts access facts
 * from that root.
 */
function semanticAccessesForExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): SemanticAccess[] {
  const root = semanticAccessRootForExpression(expression, view)
  if (!root) return []
  return semanticAccessesForNode(root.node, view, new Set(), 1)
}

/**
 * Resolves callback expressions to the function-like AST node that should be
 * scanned for access calls.
 */
function semanticAccessRootForExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): { node: SemanticAnalyzerNode<SemanticAnalyzerView> } | undefined {
  const unwrapped = unwrapExpression(expression, view)
  if (view.syntax.isFunctionLike(unwrapped)) return { node: unwrapped }
  if (!isResolvableSourceExpression(unwrapped, view)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, view)
  if (!resolved) return undefined
  const node = semanticAccessNodeForResolved(resolved, view)
  return node ? { node } : undefined
}

/**
 * Chooses the function-like declaration or initializer represented by a
 * resolved source reference.
 */
function semanticAccessNodeForResolved(
  resolved: SemanticResolvedSource,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  if (resolved.expression) {
    const expression = unwrapExpression(resolved.expression, view)
    if (view.syntax.isFunctionLike(expression)) return expression
  }
  if (view.syntax.isFunctionLike(resolved.declaration)) return resolved.declaration
  return undefined
}

/**
 * Walks a node subtree and collects direct access calls, following one level of
 * local helper function calls to preserve common callback factoring.
 */
function semanticAccessesForNode(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen: Set<string>,
  helperDepth: number,
): SemanticAccess[] {
  const accesses: SemanticAccess[] = []
  const visit = (child: SemanticAnalyzerNode<SemanticAnalyzerView>): void => {
    if (view.syntax.isKind(child, 'callExpression')) {
      accesses.push(...semanticAccessesForCall(child, view))
      const target = view.syntax.callExpressionTarget(child)
      if (helperDepth > 0 && target && view.syntax.isKind(target, 'identifier')) {
        const resolved = resolveSemanticExpression(target, view)
        const helperNode = resolved ? semanticAccessNodeForResolved(resolved, view) : undefined
        if (resolved && helperNode) {
          const key = semanticResolvedKey(resolved)
          if (!seen.has(key)) {
            const nextSeen = new Set(seen)
            nextSeen.add(key)
            accesses.push(
              ...semanticAccessesForNode(helperNode, view, nextSeen, helperDepth - 1),
            )
          }
        }
      }
    }
    view.syntax.children(child).forEach(visit)
  }
  visit(node)
  return accesses
}

/**
 * Converts one call expression into semantic access facts when it invokes a
 * known target method or direct scorer/eval callable.
 */
function semanticAccessesForCall(
  call: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): SemanticAccess[] {
  const expression = view.syntax.callExpressionTarget(call)
  if (!expression) return []
  if (!view.syntax.isKind(expression, 'propertyAccessExpression')) {
    const target = semanticTargetForExpression(expression, view)
    if (target?.kind === 'scorer') return [{ kind: 'score', target, node: call }]
    if (isEvalKind(target?.kind)) return [{ kind: 'eval', target, node: call }]
    return []
  }
  const receiver = view.syntax.propertyAccessExpression(expression)
  const target = receiver ? semanticTargetForExpression(receiver, view) : undefined
  if (!target) return []
  const method = view.syntax.propertyAccessName(expression)
  if (!method) return []
  const kind = semanticInvocationKind(method, target.kind)
  if (!kind) return []
  return [{ kind, target, node: call }]
}

/**
 * Maps target method names to semantic access kinds for resolved target kinds.
 */
function semanticInvocationKind(method: string, targetKind: ProjectDefinitionKind): SemanticAccess['kind'] | undefined {
  if (targetKind === 'memory' || targetKind === 'blackboard' || targetKind === 'workspace')
    return semanticDataAccessKind(method)
  if (
    targetKind === 'rag.retriever' &&
    ['get', 'read', 'query', 'find', 'search', 'list', 'retrieve', 'run', 'load'].includes(method)
  )
    return 'query'
  if (targetKind === 'scorer' && ['score', 'judge', 'run', 'evaluate', 'call'].includes(method)) return 'score'
  if (isEvalKind(targetKind) && ['run', 'evaluate', 'execute', 'call'].includes(method)) return 'eval'
  return undefined
}

/**
 * Maps state-resource method names to read/write direction.
 */
function semanticDataAccessKind(method: string): 'read' | 'write' | undefined {
  if (['get', 'read', 'query', 'find', 'search', 'list', 'readFile', 'load'].includes(method)) return 'read'
  if (['set', 'write', 'update', 'append', 'delete', 'put', 'writeFile', 'edit', 'deleteFile', 'save'].includes(method))
    return 'write'
  return undefined
}

/**
 * Converts a semantic access fact into a resolved Project Index relation.
 */
function semanticAccessRelation(
  fromKind: SemanticDefinitionKind | 'flow.step',
  from: string,
  access: SemanticAccess,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const type = semanticAccessRelationType(fromKind, access.kind, access.target.kind)
  if (!type) return []
  return [
    projectRelation({
      type,
      from,
      to: access.target.id,
      fidelity: 'resolved',
      source: semanticSourceForNode(access.node, view.syntax),
    }),
  ]
}

/**
 * Selects the relation type for a semantic access fact.
 */
function semanticAccessRelationType(
  fromKind: SemanticDefinitionKind | 'flow.step',
  accessKind: SemanticAccess['kind'],
  targetKind: ProjectDefinitionKind,
): string | undefined {
  if (accessKind === 'query' && targetKind === 'rag.retriever') return `${fromKind}.queries_retriever`
  if (accessKind === 'score' && targetKind === 'scorer') return `${fromKind}.uses_scorer`
  if (accessKind === 'eval' && isEvalKind(targetKind)) return `${fromKind}.runs_eval`
  if (accessKind !== 'read' && accessKind !== 'write') return undefined
  const action = accessKind === 'read' ? 'reads' : 'writes'
  switch (targetKind) {
    case 'memory':
      return `${fromKind}.${action}_memory`
    case 'blackboard':
      return `${fromKind}.${action}_blackboard`
    case 'workspace':
      return `${fromKind}.${action}_workspace`
    default:
      return undefined
  }
}
