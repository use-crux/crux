import { afterEach, describe, expect, it } from 'vitest'
import {
  createInMemoryObservabilityTransport,
  configureObservability,
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
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('keeps validated deployment identity in the owned Crux payload, never baggage', () => {
    const headers = new Headers()
    const deployment = {
      projectId: 'checkout',
      manifestId: `pim_${'b'.repeat(64)}`,
      deploymentId: 'production-42',
    }
    const carrier = sanitizePropagationCarrier({
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
      baggage: 'tenant=untrusted',
      crux: {
        runId: 'run_0123456789abcdef01234567',
        deployment,
      },
    })

    injectPropagationCarrier(carrier, headers)

    expect(extractPropagationCarrier(headers)?.crux.deployment).toEqual(
      deployment,
    )
    expect(headers.values.get('baggage')).toBe('tenant=untrusted')
    expect(headers.values.get('baggage')).not.toContain('checkout')
    expect(() =>
      sanitizePropagationCarrier({
        ...carrier,
        crux: { ...carrier.crux, deployment: { projectId: ' checkout ' } },
      }),
    ).toThrow()
  })

  it('resumes with the run-start deployment after process state changes', async () => {
    const original = { projectId: 'checkout', deploymentId: 'production-42' }
    configureObservability({ identity: original })
    const carrier = observe
      .openRun({ name: 'original', rootPrimitive: 'custom.operation' })
      .suspend({ reason: 'worker-boundary' })

    resetObservabilityRuntime()
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    configureObservability({
      identity: { projectId: 'checkout', deploymentId: 'production-43' },
    })
    observe.resumeRun(carrier, { reason: 'worker.wake' }).end()
    await observe.flush()

    expect(transport.records).not.toHaveLength(0)
    expect(
      transport.records.every(
        (record) => record.deployment?.deploymentId === 'production-42',
      ),
    ).toBe(true)
    resetObservabilityRuntime()
  })

  it('rejects a carrier that changes a deployment identity already known in-process', () => {
    configureObservability({ identity: { projectId: 'checkout', deploymentId: 'a' } })
    const run = observe.openRun({ name: 'known', rootPrimitive: 'custom.operation' })
    const carrier = run.suspend({ reason: 'handoff' })

    expect(() =>
      observe.resumeRun(
        {
          ...carrier,
          crux: {
            ...carrier.crux,
            deployment: { projectId: 'checkout', deploymentId: 'b' },
          },
        },
        { reason: 'tampered' },
      ),
    ).toThrow(/deployment identity/i)
    expect(() =>
      observe.resumeRun(
        { ...carrier, crux: { ...carrier.crux, deployment: undefined } },
        { reason: 'stripped' },
      ),
    ).toThrow(/deployment identity/i)
  })

  it('rejects attaching deployment identity to a known deployment-unspecified run', () => {
    const run = observe.openRun({
      name: 'deployment-unspecified',
      rootPrimitive: 'custom.operation',
    })
    const carrier = run.suspend({ reason: 'handoff' })

    expect(() =>
      observe.resumeRun(
        {
          ...carrier,
          crux: {
            ...carrier.crux,
            deployment: { projectId: 'attached-later' },
          },
        },
        { reason: 'tampered' },
      ),
    ).toThrow(/deployment identity/i)
  })

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

  it('falls back only when legacy operationId is omitted', () => {
    const legacy = {
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
      crux: { runId: 'run_0123456789abcdef01234567' },
    }

    expect(sanitizePropagationCarrier(legacy).crux.operationId).toBe(
      legacy.crux.runId,
    )
    expect(() =>
      sanitizePropagationCarrier({
        ...legacy,
        crux: { ...legacy.crux, operationId: null },
      }),
    ).toThrow('crux.operationId is invalid')
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
