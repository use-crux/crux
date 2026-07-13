function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function payloadValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function addString(ids: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.trim()) {
    ids.add(value)
  }
}

function addStringArray(ids: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return
  for (const item of value) {
    addString(ids, item)
  }
}

export function observabilityEventIds(messageOrEvent: unknown): string[] {
  const event =
    isRecord(messageOrEvent) && isRecord(messageOrEvent.event)
      ? messageOrEvent.event
      : isRecord(messageOrEvent)
        ? messageOrEvent
        : undefined
  if (!event) return []

  const ids = new Set<string>()
  addString(ids, event.refId)

  const payload = payloadValue(event.payload)
  if (isRecord(payload)) {
    addString(ids, payload.runId)
    addString(ids, payload.traceId)
    addStringArray(ids, payload.runIds)
    addStringArray(ids, payload.traceIds)
  }

  return [...ids]
}

/**
 * Extract the ingest-commit revision from an `ObservabilityEvent` payload, if
 * present (binding spec 04 §4's `{ entity, id, revision }` push contract).
 * `undefined` means the event carries no revision — callers should treat
 * that conservatively (catch up), not as "nothing changed".
 */
export function observabilityEventRevision(messageOrEvent: unknown): number | undefined {
  const event =
    isRecord(messageOrEvent) && isRecord(messageOrEvent.event)
      ? messageOrEvent.event
      : isRecord(messageOrEvent)
        ? messageOrEvent
        : undefined
  if (!event) return undefined
  const payload = payloadValue(event.payload)
  if (!isRecord(payload)) return undefined
  const revision = payload.revision
  return typeof revision === 'number' ? revision : undefined
}

/**
 * True when a cached query key nested under the `['observability', ...]`
 * prefix should be swept by a blanket `observability:event` WS
 * invalidation.
 *
 * Excludes the revisioned `runs-page` slice (`qk.observability.runsPage`):
 * that slice owns its own revision-gated invalidation and bounded
 * `/runs/delta` catch-up (`useObservabilityRunsPage`,
 * `shared/lib/runs-revision.ts`). Sweeping it here too would refetch it on
 * every observability push regardless of revision, nullifying that logic
 * and reintroducing the refetch storm the revision hook exists to avoid.
 */
export function isBlanketInvalidatableObservabilityQueryKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'observability' && queryKey[1] !== 'runs-page'
}
