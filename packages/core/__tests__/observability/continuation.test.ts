import { describe, expect, it } from 'vitest'
import {
  createInMemoryObservabilityTransport,
  extractPropagationCarrier,
  injectPropagationCarrier,
  observe,
  resetObservabilityRuntime,
  sanitizePropagationCarrier,
  setObservabilityTransport,
} from '../../src/observability'

class Headers {
  readonly values = new Map<string, string>()

  get(name: string): string | null {
    return this.values.get(name) ?? null
  }

  set(name: string, value: string): void {
    this.values.set(name, value)
  }
}

describe('Crux propagation carriers', () => {
  it('round-trips only the serializable boundary fields', () => {
    const headers = new Headers()
    const carrier = sanitizePropagationCarrier({
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
      crux: {
        runId: 'run_0123456789abcdef01234567',
        previousSegmentId: 'seg_0123456789abcdef01234567',
        parentSpanId: '0123456789abcdef',
        sessionId: 'untrusted-session',
        userId: 'untrusted-user',
      },
    })

    injectPropagationCarrier(carrier, headers)

    expect(extractPropagationCarrier(headers)).toEqual(carrier)
    expect(headers.values.get('crux')).not.toContain('traceparent')
  })

  it('drops hostile inbound carrier data without throwing through the boundary', () => {
    const headers = new Headers()
    headers.set('traceparent', '00-00000000000000000000000000000000-0000000000000000-01')
    headers.set('crux', JSON.stringify({ runId: 'not-a-crux-run' }))

    expect(extractPropagationCarrier(headers)).toBeUndefined()
    expect(() =>
      sanitizePropagationCarrier({
        traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
        crux: { runId: 'run_0123456789abcdef01234567', userId: 'x'.repeat(201) },
      }),
    ).toThrow('userId is invalid')
  })

  it('does not turn propagated correlators into trusted run identity', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const carrier = sanitizePropagationCarrier({
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
      crux: {
        runId: 'run_0123456789abcdef01234567',
        sessionId: 'untrusted-session',
        userId: 'untrusted-user',
      },
    })

    observe.resumeRun(carrier, { reason: 'worker.wake' }).end()
    await observe.flush()

    expect(transport.records[0]).toMatchObject({ type: 'run:resume', runId: carrier.crux.runId })
    expect(transport.records[0]).not.toHaveProperty('sessionId')
    expect(transport.records[0]).not.toHaveProperty('userId')
    resetObservabilityRuntime()
  })
})
