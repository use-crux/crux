import ts from 'typescript'
import type { ProjectRelation } from '@crux/core/project-index'
import { safeId } from '../definitions'
import type { SemanticAnalyzerView, SemanticDefinitionCandidate } from './candidates'
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
  const handoffs = propertyInitializer(candidate.object, 'handoffs')
  if (!handoffs) return []
  return semanticHandoffExpressions(toExpression(handoffs), view).map((targetId) =>
    semanticRelation(candidate, 'agent.can_handoff_to', candidate.definitionId, `agent:${safeId(targetId)}`),
  )
}

function semanticHandoffExpressions(
  expression: ts.Expression,
  view: SemanticAnalyzerView,
  seen = new Set<string>(),
): string[] {
  const array = semanticArrayExpression(expression, view, seen)
  if (!array) return []
  return array.elements.flatMap((element) => {
    if (ts.isSpreadElement(element)) return semanticHandoffExpressions(element.expression, view, seen)
    return ts.isExpression(element) ? (semanticHandoffTargetId(element, view, seen) ?? []) : []
  })
}

function semanticHandoffTargetId(
  expression: ts.Expression,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): string | undefined {
  const unwrapped = unwrapExpression(expression)
  if (ts.isStringLiteralLike(unwrapped)) return unwrapped.text
  const object = ts.isObjectLiteralExpression(unwrapped) ? unwrapped : semanticObjectExpression(unwrapped, view, seen)
  return object ? semanticStringLiteralProperty(object, 'id') : undefined
}
