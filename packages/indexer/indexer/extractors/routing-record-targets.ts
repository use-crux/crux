import type { StaticRelationRef } from '../types'

export type RoutingTargetOwner = 'router.route' | 'cascade.tier' | 'fallback.option'

/** Builds unresolved relation refs for route, tier, and fallback option targets. */
export function routingTargetRelationRefs(
  fromId: string,
  toVariable: string | undefined,
  owner: RoutingTargetOwner,
): StaticRelationRef[] {
  if (!toVariable) return []
  const types = routingTargetTypes(owner)
  return [
    {
      type: types.router,
      typeByTargetKind: {
        'routing.router': types.router,
        'routing.cascade': types.cascade,
        'routing.fallback': types.fallback,
        agent: types.agent,
        prompt: types.prompt,
      },
      fromId,
      toVariable,
    },
  ]
}

function routingTargetTypes(owner: RoutingTargetOwner): {
  readonly router: string
  readonly cascade: string
  readonly fallback?: string
  readonly agent: string
  readonly prompt: string
} {
  switch (owner) {
    case 'router.route':
      return {
        router: 'router.route.uses_router',
        cascade: 'router.route.uses_cascade',
        fallback: 'router.route.uses_fallback',
        agent: 'router.route.uses_agent',
        prompt: 'router.route.uses_prompt',
      }
    case 'cascade.tier':
      return {
        router: 'cascade.tier.uses_router',
        cascade: 'cascade.tier.uses_cascade',
        fallback: 'cascade.tier.uses_fallback',
        agent: 'cascade.tier.uses_agent',
        prompt: 'cascade.tier.uses_prompt',
      }
    case 'fallback.option':
      return {
        router: 'fallback.option.uses_router',
        cascade: 'fallback.option.uses_cascade',
        fallback: 'fallback.option.uses_fallback',
        agent: 'fallback.option.uses_agent',
        prompt: 'fallback.option.uses_prompt',
      }
    default:
      return assertNever(owner)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled routing owner: ${String(value)}`)
}
