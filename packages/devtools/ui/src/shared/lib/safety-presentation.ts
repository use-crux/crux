/** Compact label and safe identifier derived from ingress provenance. */
export interface InputOriginFacts {
  source?: string
  identifier?: string
}

/** Return semantic display copy for known Safety targets with a safe fallback. */
export function safetyTargetLabel(target: string): string {
  switch (target) {
    case 'model.input.text':
      return 'Model input · Text'
    case 'model.input.media':
      return 'Model input · Media'
    case 'model.instructions':
      return 'Model instructions'
    default:
      return target
  }
}

/** Derive a source label and safe identifier from an unknown runtime origin. */
export function inputOriginFacts(value: unknown): InputOriginFacts {
  const origin = isRecord(value) ? value : undefined
  const source = typeof origin?.source === 'string' ? origin.source : undefined
  return {
    ...(source ? { source: sourceLabel(source) } : {}),
    ...identifierForOrigin(source, origin),
  }
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'user':
      return 'User'
    case 'tool':
      return 'Tool'
    case 'retrieval':
      return 'Retrieval'
    default:
      return source
  }
}

function identifierForOrigin(
  source: string | undefined,
  origin: Record<string, unknown> | undefined,
): { readonly identifier?: string } {
  if (!origin) return {}
  if (source === 'tool') return joinedIdentifier(origin.toolName, origin.toolCallId)
  if (source === 'retrieval' && typeof origin.retrieverId === 'string') {
    return { identifier: origin.retrieverId }
  }
  return {}
}

function joinedIdentifier(...values: readonly unknown[]): {
  readonly identifier?: string
} {
  const safe = values.filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
  return safe.length > 0 ? { identifier: safe.join(' · ') } : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
