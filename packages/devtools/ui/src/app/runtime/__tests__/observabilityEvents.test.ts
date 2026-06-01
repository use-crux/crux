import { describe, expect, it } from 'vitest'
import { observabilityEventIds } from '../observabilityEvents'

describe('observabilityEventIds', () => {
  it('extracts run and trace ids from observability WS events', () => {
    expect(
      observabilityEventIds({
        type: 'observability:event',
        event: {
          refId: 'run_ref',
          payload: {
            runId: 'run_payload',
            traceId: 'trace_payload',
            runIds: ['run_deleted'],
            traceIds: ['trace_deleted'],
          },
        },
      }),
    ).toEqual(['run_ref', 'run_payload', 'trace_payload', 'run_deleted', 'trace_deleted'])
  })

  it('extracts ids from serialized event payloads', () => {
    expect(
      observabilityEventIds({
        refId: 'run_ref',
        payload: JSON.stringify({
          runId: 'run_payload',
          traceId: 'trace_payload',
        }),
      }),
    ).toEqual(['run_ref', 'run_payload', 'trace_payload'])
  })
})
