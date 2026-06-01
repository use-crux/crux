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
