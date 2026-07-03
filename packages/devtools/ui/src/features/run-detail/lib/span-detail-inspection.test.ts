import { describe, expect, it } from 'vitest'
import { tokenChunksFromEvents } from './span-detail-inspection'
import type { ObservabilitySpanEventSummary } from '@/types'

describe('span detail inspection helpers', () => {
  it('extracts token chunk text from lazy span events in stream order', () => {
    const events = [
      tokenEvent('event-2', '2026-07-03T10:00:00.200Z', ' world', 2),
      tokenEvent('event-1', '2026-07-03T10:00:00.100Z', 'Hello', 1),
      {
        ...tokenEvent('event-empty', '2026-07-03T10:00:00.300Z', '', 3),
        attributes: { text: '' },
      },
    ]

    expect(tokenChunksFromEvents(events)).toEqual(['Hello', ' world'])
  })
})

function tokenEvent(
  eventId: string,
  timestamp: string,
  text: string,
  chunkIndex: number,
): ObservabilitySpanEventSummary {
  return {
    eventId,
    runId: 'run_stream',
    traceId: 'trace_stream',
    spanId: 'span_stream',
    name: 'token.chunk',
    timestamp,
    attributes: { text, chunkIndex },
  }
}
