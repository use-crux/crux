import type { ProjectRelation, SourceLocation } from '@crux/core/project-index'
import { indexRelationPolicies } from './policies'
import type { IndexRelationPolicy } from './types'

export { indexRelationPolicies } from './policies'
export type { IndexRelationPolicy, IndexRelationPresentation } from './types'

/**
 * Looks up the canonical relation policy for a Project Index relation type.
 *
 * This is a pure table projection used by both static and semantic indexing so
 * every relation receives the same presentation and runtime-join semantics.
 */
export function relationPolicyFor(type: string): IndexRelationPolicy | undefined {
  return indexRelationPolicies.find((policy) => policy.type === type)
}

/**
 * Builds the stable identifier used for statically discovered relations.
 *
 * Static relation ids intentionally share the resolved relation id shape so
 * later semantic passes can replace low-fidelity facts without changing edge
 * identity.
 */
export function staticRelationId(from: string, type: string, to: string): string {
  return resolvedRelationId(type, from, to)
}

/**
 * Builds the canonical Project Index relation id from its semantic triple.
 *
 * The function is deterministic and side-effect free, making it safe to use in
 * cache keys, tests, and patch reconciliation.
 */
export function resolvedRelationId(type: string, from: string, to: string): string {
  return `relation:${type}:${from}:${to}`
}

/**
 * Creates a normalized Project Index relation value from authored relation
 * components.
 *
 * The input object is treated as immutable; callers receive a fresh relation
 * with a stable id derived from the relation triple unless an explicit id is
 * supplied.
 */
export function projectRelation(input: {
  readonly type: string
  readonly from: string
  readonly to: string
  readonly fidelity: ProjectRelation['fidelity']
  readonly source?: SourceLocation
  readonly id?: string
}): ProjectRelation {
  return {
    id:
      input.id ??
      (input.fidelity === 'resolved'
        ? resolvedRelationId(input.type, input.from, input.to)
        : staticRelationId(input.from, input.type, input.to)),
    type: input.type,
    from: input.from,
    to: input.to,
    fidelity: input.fidelity,
    ...(input.source ? { source: input.source } : {}),
  }
}
