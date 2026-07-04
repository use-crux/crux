import { afterEach, describe, expect, it } from 'vitest'
import {
  createInMemoryObservabilityTransport,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
  subscribeObservability,
  type CruxAttributes,
  type CruxGraphRecord,
  type CruxMetrics,
} from '../../observability'

describe('observability invariants', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('coerces undefined metric values without throwing or dropping the span end record', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const run = observe.openRun({
      name: 'coerce metrics',
      rootPrimitive: 'custom.operation',
    })
    run.withContext(() => {
      const span = observe.openSpan({
        name: 'metric span',
        primitive: 'custom.operation',
      })
      expect(() => span.end({ metrics: { x: undefined } })).not.toThrow()
    })
    run.end()
    await observe.flush()

    const spanEnd = transport.records.find((record) => record.type === 'span:end')
    expect(spanEnd).toMatchObject({
      type: 'span:end',
      metrics: {},
    })
    expect(observabilityDiagnostics()).toMatchObject({
      droppedRecords: 0,
      invalidRecords: 0,
    })
  })

  it('coerces non-finite metric values without throwing or dropping the span end record', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const run = observe.openRun({
      name: 'coerce finite metrics',
      rootPrimitive: 'custom.operation',
    })
    run.withContext(() => {
      const span = observe.openSpan({
        name: 'nan metric span',
        primitive: 'custom.operation',
      })
      expect(() => span.end({ metrics: { x: Number.NaN } })).not.toThrow()
    })
    run.end()
    await observe.flush()

    const spanEnd = transport.records.find((record) => record.type === 'span:end')
    expect(spanEnd).toMatchObject({
      type: 'span:end',
      metrics: {},
    })
    expect(observabilityDiagnostics()).toMatchObject({
      droppedRecords: 0,
      invalidRecords: 0,
    })
  })

  it('coerces empty record names without throwing or dropping the start record', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    expect(() => observe.openRun({ name: '', rootPrimitive: 'custom.operation' })).not.toThrow()
    await observe.flush()

    expect(transport.records[0]).toMatchObject({
      type: 'run:start',
      name: 'unknown',
    })
    expect(observabilityDiagnostics()).toMatchObject({
      droppedRecords: 0,
      invalidRecords: 0,
    })
  })

  it('rethrows an empty-message user error instead of replacing it with a validation error', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const userError = new Error('')

    await expect(
      observe.run({ name: 'user error run', rootPrimitive: 'custom.operation' }, async () => {
        await observe.span(
          {
            name: 'user error span',
            primitive: 'custom.operation',
          },
          async () => {
            throw userError
          },
        )
      }),
    ).rejects.toBe(userError)
    await observe.flush()

    const spanEnd = transport.records.find((record) => record.type === 'span:end')
    const runEnd = transport.records.find((record) => record.type === 'run:end')
    const rawError = transport.records.find((record) => record.type === 'artifact' && record.kind === 'error.raw')
    expect(spanEnd).toMatchObject({
      type: 'span:end',
      error: { message: 'Error' },
    })
    expect(runEnd).toMatchObject({
      type: 'run:end',
      error: { message: 'Error' },
    })
    expect(rawError).toMatchObject({
      type: 'artifact',
      preview: { message: 'Error' },
    })
    expect(observabilityDiagnostics()).toMatchObject({
      droppedRecords: 0,
      invalidRecords: 0,
    })
  })

  it('rethrows a hostile user error instead of leaking observability construction failures', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const userError = new Error('fallback')
    Object.defineProperty(userError, 'message', {
      get() {
        throw new Error('message getter failed')
      },
    })

    await expect(
      observe.span(
        {
          name: 'hostile user error span',
          primitive: 'custom.operation',
        },
        async () => {
          throw userError
        },
      ),
    ).rejects.toBe(userError)
    await observe.flush()

    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'span:start' }))
    expect(observabilityDiagnostics().invalidRecords).toBeGreaterThan(0)
  })

  it('counts hostile attribute getters instead of throwing instrumentation failures', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const attributes = hostileGetterAttributes()

    await expect(
      observe.run({ name: 'hostile attributes', rootPrimitive: 'custom.operation', attributes }, async () => {
        observe.event({ name: 'hostile event', attributes })
      }),
    ).resolves.toBeUndefined()
    await observe.flush()

    expect(observabilityDiagnostics().invalidRecords).toBeGreaterThan(0)
  })

  it('handles hostile attribute toString values instead of throwing instrumentation failures', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const attributes: CruxAttributes = { hostile: hostileToStringValue() }

    await expect(
      observe.run({ name: 'hostile toString attributes', rootPrimitive: 'custom.operation', attributes }, async () => {
        observe.event({ name: 'hostile toString event', attributes })
      }),
    ).resolves.toBeUndefined()
    await observe.flush()

    expect(transport.records.length + observabilityDiagnostics().invalidRecords).toBeGreaterThan(0)
  })

  it('drops and counts records that remain invalid after coercion', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const run = observe.openRun({ name: 'invalid metrics', rootPrimitive: 'custom.operation' })
    run.withContext(() => {
      const span = observe.openSpan({ name: 'invalid metric key', primitive: 'custom.operation' })
      expect(() => span.end({ metrics: { cacheWaitMs: 1 } as unknown as CruxMetrics })).not.toThrow()
    })
    run.end()
    await observe.flush()

    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'span:start' }))
    expect(transport.records).not.toContainEqual(expect.objectContaining({ type: 'span:end' }))
    expect(observabilityDiagnostics()).toMatchObject({
      droppedRecords: 0,
      invalidRecords: 1,
    })
  })

  it('sanitizes records before subscribers and in-memory transport receive them', async () => {
    const transport = createInMemoryObservabilityTransport()
    const subscriberRecords: CruxGraphRecord[] = []
    setObservabilityTransport(transport)
    subscribeObservability((record) => {
      subscriberRecords.push(record)
    })
    const cyclic: Record<string, unknown> = { id: 'cyclic' }
    cyclic.self = cyclic

    await observe.run({ name: 'sanitize before fanout', rootPrimitive: 'custom.operation' }, async () => {
      await observe.span({ name: 'producer', primitive: 'custom.operation' }, async () => {
        observe.artifact({
          kind: 'output',
          contentType: 'application/json',
          encoding: 'json',
          preview: {
            count: 1n,
            cyclic,
          },
        })
      })
    })
    await observe.flush()

    const subscriberArtifact = subscriberRecords.find((record) => record.type === 'artifact')
    const transportArtifact = transport.records.find((record) => record.type === 'artifact')
    expect(subscriberArtifact).toMatchObject({
      type: 'artifact',
      preview: {
        count: '1',
        cyclic: { id: 'cyclic', self: '[Circular]' },
      },
    })
    expect(transportArtifact).toMatchObject(subscriberArtifact)
  })
})

function hostileGetterAttributes(): CruxAttributes {
  const attributes: CruxAttributes = {}
  Object.defineProperty(attributes, 'throwsOnRead', {
    enumerable: true,
    get() {
      throw new Error('attribute getter failed')
    },
  })
  return attributes
}

function hostileToStringValue(): unknown {
  return {
    toString() {
      throw new Error('attribute toString failed')
    },
  }
}
