import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createInMemoryObservabilityTransport,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import { __setAlsForTesting } from '../../src/observability/observe'

describe('observe runtime without AsyncLocalStorage', () => {
  afterEach(() => {
    __setAlsForTesting('auto')
    resetObservabilityRuntime()
  })

  it('parents nested manual spans through explicit synchronous contexts', async () => {
    __setAlsForTesting(null)
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const run = observe.openRun({ name: 'sync fallback run', rootPrimitive: 'custom.operation' })
    run.withContext(() => {
      const parent = observe.openSpan({
        name: 'parent',
        primitive: 'custom.operation',
      })
      parent.withContext(() => {
        const child = observe.openSpan({
          name: 'child',
          primitive: 'custom.operation',
        })
        child.end()
      })
      parent.end()
    })
    run.end()

    await observe.flush()

    expect(transport.records.map((record) => record.type)).toEqual([
      'run:start',
      'span:start',
      'span:start',
      'span:end',
      'span:end',
      'run:end',
    ])
    const spanStarts = transport.records.filter((record) => record.type === 'span:start')
    expect(spanStarts).toHaveLength(2)
    expect(spanStarts[1]).toMatchObject({
      runId: run.runId,
      traceId: run.traceId,
      parentSpanId: spanStarts[0].spanId,
    })
  })

  it('runs synchronous nested spans inside observe.run', async () => {
    __setAlsForTesting(null)
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const result = await observe.run({ name: 'sync run', rootPrimitive: 'custom.operation' }, () => {
      return observe.span({ name: 'sync span', primitive: 'custom.operation' }, () => 'ok')
    })

    await observe.flush()

    expect(result).toBe('ok')
    expect(transport.records.map((record) => record.type)).toEqual(['run:start', 'span:start', 'span:end', 'run:end'])
  })

  it('requires explicit context after an async fallback boundary', async () => {
    __setAlsForTesting(null)
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const run = observe.openRun({ name: 'explicit async fallback', rootPrimitive: 'custom.operation' })
    let captured = undefined
    await run.withContext(async () => {
      captured = observe.captureContext()
      await Promise.resolve()
      expect(observe.captureContext()).toBeUndefined()
    })
    expect(captured).toBeDefined()

    observe.withContext(captured, () => {
      observe.openSpan({ name: 'explicit child', primitive: 'custom.operation' }).end()
    })
    run.end()
    await observe.flush()

    expect(transport.records.filter((record) => record.type === 'span:start')).toContainEqual(
      expect.objectContaining({ runId: run.runId, name: 'explicit child' }),
    )
  })

  it('opens one implicit run for standalone spans without recursive fallback', async () => {
    __setAlsForTesting(null)
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const result = await observe.span(
      { name: 'standalone', primitive: 'custom.operation' },
      () => 'ok',
    )

    await observe.flush()

    expect(result).toBe('ok')
    expect(transport.records.map((record) => record.type)).toEqual(['run:start', 'span:start', 'span:end', 'run:end'])
    expect(transport.records.filter((record) => record.type === 'run:start')).toHaveLength(1)
  })

  it('counts contextless event artifact and edge attempts', () => {
    __setAlsForTesting(null)
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    observe.event({ name: 'orphan event' })
    const artifactId = observe.artifact({
      kind: 'output',
      contentType: 'text/plain',
      encoding: 'text',
      preview: 'orphan output',
    })
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: 'span_orphan' },
      to: { kind: 'artifact', id: 'artifact_orphan' },
    })

    expect(artifactId).toBeUndefined()
    expect(transport.records).toEqual([])
    expect(observabilityDiagnostics().contextlessRecords).toBe(3)
  })

  it('warns once in development when AsyncLocalStorage is unavailable', () => {
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      __setAlsForTesting(null)
      observe.captureContext()
      observe.captureContext()
      observe.event({ name: 'orphan event' })

      const runtimeWarnings = warn.mock.calls.filter(([message]) =>
        String(message).includes('AsyncLocalStorage is unavailable'),
      )
      expect(runtimeWarnings).toHaveLength(1)
    } finally {
      warn.mockRestore()
      process.env.NODE_ENV = originalNodeEnv
    }
  })
})
