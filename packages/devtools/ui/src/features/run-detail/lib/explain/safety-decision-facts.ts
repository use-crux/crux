import type { TurnDecision } from '@/types'
import { inputOriginFacts, safetyTargetLabel } from '@/shared/lib/safety-presentation'

/** Compact, content-free facts rendered beside a Safety decision. */
export interface SafetyDecisionFacts {
  target: string
  source?: string
  identifier?: string
  posture: string
}

/** Derive render-safe target and provenance labels from a canonical decision. */
export function safetyDecisionFacts(
  decision: Pick<TurnDecision, 'safety'>,
): SafetyDecisionFacts | undefined {
  const safety = decision.safety
  if (!safety) return undefined

  const origin = inputOriginFacts(safety.origin)

  return {
    target: safety.target.label || safetyTargetLabel(safety.target.id) || 'Unknown safety target',
    ...origin,
    posture: safety.changed ? `${safety.mode} · changed` : safety.mode,
  }
}
