import type { ProjectRelation } from '@use-crux/core/project-index'
import { safeId } from '../definitions'
import type { SemanticAnalyzerNode, SemanticAnalyzerView, SemanticDefinitionCandidate } from './candidates'
import {
  propertyInitializer,
  semanticArrayExpression,
  semanticObjectExpression,
  semanticRelation,
  semanticStringLiteralProperty,
  toExpression,
  unwrapExpression,
} from './model'

/**
 * Resolves literal agent handoff declarations into authored graph edges.
 */
export function semanticAgentHandoffRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const handoffs = propertyInitializer(candidate.object, 'handoffs', view)
  if (!handoffs) return []
  return semanticHandoffExpressions(toExpression(handoffs, view), view).map((targetId) =>
    semanticRelation(candidate, 'agent.can_handoff_to', candidate.definitionId, `agent:${safeId(targetId)}`, view),
  )
}

function semanticHandoffExpressions(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen = new Set<string>(),
): string[] {
  const array = semanticArrayExpression(expression, view, seen)
  if (!array) return []
  return view.syntax.arrayElements(array).flatMap((element) => {
    const spread = view.syntax.spreadExpression(element)
    if (spread) return semanticHandoffExpressions(spread, view, seen)
    return semanticHandoffTargetId(element, view, seen) ?? []
  })
}

function semanticHandoffTargetId(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): string | undefined {
  const unwrapped = unwrapExpression(expression, view)
  const literal = view.syntax.stringLiteralText(unwrapped)
  if (literal !== undefined) return literal
  const object = view.syntax.isKind(unwrapped, 'objectLiteral') ? unwrapped : semanticObjectExpression(unwrapped, view, seen)
  return object ? semanticStringLiteralProperty(object, 'id', view) : undefined
}
