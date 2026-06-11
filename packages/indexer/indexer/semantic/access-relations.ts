import ts from 'typescript'
import type { ProjectDefinitionKind, ProjectRelation } from '@crux/core/project-index'
import { sourceForNode } from '../ast/snippets'
import { safeId } from '../definitions'
import { projectRelation } from '../relations/index'
import type { SemanticDefinitionCandidate, SemanticDefinitionKind, SemanticResolvedSource, SemanticTarget } from './candidates'
import {
  isEvalKind,
  isResolvableSourceExpression,
  semanticIsFunctionLike,
  semanticResolvedKey,
  semanticTargetForExpression,
  propertyInitializer,
  resolveSemanticExpression,
  unwrapExpression,
} from './model'

interface SemanticAccess {
  readonly kind: 'read' | 'write' | 'query' | 'score' | 'eval'
  readonly target: SemanticTarget
  readonly sourceFile: ts.SourceFile
  readonly node: ts.Node
}

/**
 * Resolves resource, retriever, scorer, and eval accesses from callback-style
 * properties on a semantic definition candidate.
 */
export function semanticCallbackAccessRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  return semanticCallbackProperties(candidate.kind)
    .flatMap((property) => {
      const expression = propertyInitializer(candidate.object, property)
      return expression ? semanticAccessesForExpression(expression, checker) : []
    })
    .flatMap((access) => semanticAccessRelation(candidate.kind, candidate.definitionId, access))
}

/**
 * Resolves accesses made by flow step targets and anchors the relations on the
 * corresponding folded flow-step definition id.
 */
export function semanticFlowAccessRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  const handler = propertyInitializer(candidate.object, 'handler')
  if (!handler) return []
  const relations: ProjectRelation[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'step'
    ) {
      const [stepArg, targetArg] = node.arguments
      if (stepArg && ts.isStringLiteralLike(stepArg) && targetArg) {
        const from = `flow.step:${safeId(candidate.name)}:${safeId(stepArg.text)}`
        for (const access of semanticAccessesForExpression(targetArg, checker)) {
          relations.push(...semanticAccessRelation('flow.step', from, access))
        }
      }
    }
    ts.forEachChild(node, visit)
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
function semanticAccessesForExpression(expression: ts.Expression, checker: ts.TypeChecker): SemanticAccess[] {
  const root = semanticAccessRootForExpression(expression, checker)
  if (!root) return []
  return semanticAccessesForNode(root.node, root.sourceFile, checker, new Set(), 1)
}

/**
 * Resolves callback expressions to the function-like AST node that should be
 * scanned for access calls.
 */
function semanticAccessRootForExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): { node: ts.Node; sourceFile: ts.SourceFile } | undefined {
  const unwrapped = unwrapExpression(expression)
  if (semanticIsFunctionLike(unwrapped)) return { node: unwrapped, sourceFile: unwrapped.getSourceFile() }
  if (!isResolvableSourceExpression(unwrapped)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, checker)
  if (!resolved) return undefined
  const node = semanticAccessNodeForResolved(resolved)
  return node ? { node, sourceFile: node.getSourceFile() } : undefined
}

/**
 * Chooses the function-like declaration or initializer represented by a
 * resolved source reference.
 */
function semanticAccessNodeForResolved(resolved: SemanticResolvedSource): ts.Node | undefined {
  if (resolved.expression) {
    const expression = unwrapExpression(resolved.expression)
    if (semanticIsFunctionLike(expression)) return expression
  }
  if (semanticIsFunctionLike(resolved.declaration)) return resolved.declaration
  return undefined
}

/**
 * Walks a node subtree and collects direct access calls, following one level of
 * local helper function calls to preserve common callback factoring.
 */
function semanticAccessesForNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  seen: Set<string>,
  helperDepth: number,
): SemanticAccess[] {
  const accesses: SemanticAccess[] = []
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child)) {
      accesses.push(...semanticAccessesForCall(child, sourceFile, checker))
      if (helperDepth > 0 && ts.isIdentifier(child.expression)) {
        const resolved = resolveSemanticExpression(child.expression, checker)
        const helperNode = resolved ? semanticAccessNodeForResolved(resolved) : undefined
        if (resolved && helperNode) {
          const key = semanticResolvedKey(resolved)
          if (!seen.has(key)) {
            const nextSeen = new Set(seen)
            nextSeen.add(key)
            accesses.push(
              ...semanticAccessesForNode(helperNode, helperNode.getSourceFile(), checker, nextSeen, helperDepth - 1),
            )
          }
        }
      }
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return accesses
}

/**
 * Converts one call expression into semantic access facts when it invokes a
 * known target method or direct scorer/eval callable.
 */
function semanticAccessesForCall(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): SemanticAccess[] {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    const target = semanticTargetForExpression(call.expression, checker)
    if (target?.kind === 'scorer') return [{ kind: 'score', target, sourceFile, node: call }]
    if (isEvalKind(target?.kind)) return [{ kind: 'eval', target, sourceFile, node: call }]
    return []
  }
  const target = semanticTargetForExpression(call.expression.expression, checker)
  if (!target) return []
  const method = call.expression.name.text
  const kind = semanticInvocationKind(method, target.kind)
  if (!kind) return []
  return [{ kind, target, sourceFile, node: call }]
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
): ProjectRelation[] {
  const type = semanticAccessRelationType(fromKind, access.kind, access.target.kind)
  if (!type) return []
  return [
    projectRelation({
      type,
      from,
      to: access.target.id,
      fidelity: 'resolved',
      source: sourceForNode(access.sourceFile, access.node),
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
