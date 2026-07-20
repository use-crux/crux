import type { TurnDecision } from '@/types'

type DecisionLocation = NonNullable<TurnDecision['location']>

/** Render privacy-safe canonical media coordinates for one decision row. */
export function decisionLocationLabel(location: DecisionLocation): string {
  const { origin, partType } = location
  switch (origin.kind) {
    case 'message':
      return `message ${origin.messageIndex} · part ${origin.partIndex} · ${partType}`
    case 'step':
      return `step ${origin.stepIndex} · part ${origin.partIndex} · ${partType}`
    case 'operation':
      return `${origin.operation} · ${origin.phase} · ${origin.field} · part ${origin.partIndex} · ${partType}`
    default:
      return assertNever(origin)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown media decision origin: ${String(value)}`)
}
