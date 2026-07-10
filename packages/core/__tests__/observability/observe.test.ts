import { afterEach, describe, expect, it, vi } from 'vitest'
import { channel } from 'node:diagnostics_channel'
import {
  CRUX_OBSERVABILITY_CHANNEL,
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  acceptedDeliveryReceipt,
  type CapturedObservabilityContext,
  type CruxObservabilityChannelMessage,
  type CruxGraphRecord,
  configureObservability,
  createHttpObservabilityTransport,
  createCruxTraceId,
  createCruxArtifactId,
  createInMemoryObservabilityTransport,
  observe,
  observabilityDiagnostics,
  observabilityDeliveryErrors,
  propagateAttributes,
  resetObservabilityRuntime,
  setObservabilityTransport,
  subscribeObservability,
} from '../../src/observability'
import { chaosTransport } from './helpers/chaos-transport'
import { expectBalancedGraph } from './helpers/expect-balanced-graph'

describe('observe runtime', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('emits run and span lifecycle records through the configured transport', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const result = await observe.run(
      { name: 'support reply', rootPrimitive: 'custom.operation' },
      async () => {
        return await observe.span(
          { name: 'prepare context', primitive: 'custom.operation' },
          async () => {
            return 'done'
          },
        )
      },
    )

    await observe.flush()

    expect(result).toBe('done')
    expect(transport.records.map((record) => record.type)).toEqual([
      'run:start',
      'span:start',
      'span:end',
      'run:end',
    ])

    const [runStart, spanStart, spanEnd, runEnd] = transport.records
    expect(runStart).toMatchObject({
      type: 'run:start',
      name: 'support reply',
      status: 'running',
    })
    expect(spanStart.segmentId).toBe(runStart.segmentId)
    expect(spanEnd.segmentId).toBe(runStart.segmentId)
    expect(runEnd.segmentId).toBe(runStart.segmentId)
    expect(spanStart).toMatchObject({
      type: 'span:start',
      runId: runStart.runId,
      traceId: runStart.traceId,
      family: 'custom',
      primitive: 'custom.operation',
      status: 'running',
    })
    expect(spanEnd).toMatchObject({
      type: 'span:end',
      runId: runStart.runId,
      spanId: spanStart.spanId,
      status: 'ok',
    })
    expect(runEnd).toMatchObject({
      type: 'run:end',
      runId: runStart.runId,
      traceId: runStart.traceId,
      status: 'ok',
    })
  })

  it('delivers records to subscribers without a configured transport', async () => {
    const records: string[] = []
    subscribeObservability((record) => {
      records.push(record.type)
    })

    await observe.run(
      { name: 'subscriber only', rootPrimitive: 'custom.operation' },
      async () => 'ok',
    )

    expect(records).toEqual(['run:start', 'run:end'])
    expect(observabilityDiagnostics()).toMatchObject({
      pendingDeliveries: 0,
      droppedRecords: 0,
      subscriberErrors: 0,
    })
  })

  it('uses the provided trace id for callback runs', async () => {
    const transport = createInMemoryObservabilityTransport()
    const traceId = createCruxTraceId()
    setObservabilityTransport(transport)

    await observe.run(
      { name: 'joined workflow', rootPrimitive: 'custom.operation', traceId },
      async () => 'ok',
    )
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({ type: 'run:start', traceId }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({ type: 'run:end', traceId }),
    )
  })

  it('filters narrowed subscribers before invoking them', async () => {
    const records: string[] = []
    subscribeObservability(['span:start', 'span:end'] as const, (record) => {
      records.push(record.type)
    })

    await observe.run(
      { name: 'subscriber filtered', rootPrimitive: 'custom.operation' },
      async () => {
        await observe.span(
          { name: 'filtered span', primitive: 'custom.operation' },
          async () => 'ok',
        )
      },
    )

    expect(records).toEqual(['span:start', 'span:end'])
    expect(observabilityDiagnostics()).toMatchObject({
      subscriberErrors: 0,
    })
  })

  it('propagates correlators onto every record and lets nested scopes override shallow fields', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    await propagateAttributes(
      {
        sessionId: 'session-1',
        userId: 'user-outer',
        metadata: {
          requestId: 'request-1',
          phase: 'outer',
          long: 'x'.repeat(240),
        },
      },
      async () => {
        await observe.run(
          {
            name: 'correlated run',
            rootPrimitive: 'custom.operation',
            attributes: { local: 'run' },
          },
          async () => {
            await propagateAttributes(
              { userId: 'user-inner', metadata: { phase: 'inner' } },
              async () => {
                await observe.span(
                  {
                    name: 'correlated span',
                    primitive: 'custom.operation',
                    attributes: { local: 'span' },
                  },
                  async () => undefined,
                )
              },
            )
          },
        )
      },
    )
    await observe.flush()

    expect(
      transport.records.every((record) => record.sessionId === 'session-1'),
    ).toBe(true)

    const [runStart, spanStart, spanEnd, runEnd] = transport.records
    expect(runStart).toMatchObject({
      type: 'run:start',
      userId: 'user-outer',
      attributes: {
        local: 'run',
        'meta.requestId': 'request-1',
        'meta.phase': 'outer',
        'meta.long': 'x'.repeat(200),
      },
    })
    expect(spanStart).toMatchObject({
      type: 'span:start',
      userId: 'user-inner',
      attributes: {
        local: 'span',
        'meta.requestId': 'request-1',
        'meta.phase': 'inner',
      },
    })
    expect(spanEnd).toMatchObject({
      type: 'span:end',
      userId: 'user-inner',
      attributes: {
        'meta.requestId': 'request-1',
        'meta.phase': 'inner',
      },
    })
    expect(runEnd).toMatchObject({
      type: 'run:end',
      userId: 'user-outer',
      attributes: {
        'meta.requestId': 'request-1',
        'meta.phase': 'outer',
      },
    })
  })

  it('applies configured default correlators only when no active scope provides correlators', async () => {
    const records: Array<
      Parameters<Parameters<typeof subscribeObservability>[0]>[0]
    > = []
    subscribeObservability((record) => {
      records.push(record)
    })
    const restore = configureObservability({
      defaultCorrelators: {
        sessionId: 'default-session',
        userId: 'default-user',
      },
    })

    await observe.run(
      { name: 'default correlated run', rootPrimitive: 'custom.operation' },
      async () => undefined,
    )
    await propagateAttributes({ sessionId: 'scoped-session' }, async () => {
      await observe.run(
        { name: 'scoped correlated run', rootPrimitive: 'custom.operation' },
        async () => undefined,
      )
    })
    restore()
    await observe.run(
      { name: 'after restore', rootPrimitive: 'custom.operation' },
      async () => undefined,
    )

    const runStarts = records.filter((record) => record.type === 'run:start')
    expect(runStarts).toHaveLength(3)
    expect(runStarts[0]).toMatchObject({
      sessionId: 'default-session',
      userId: 'default-user',
    })
    expect(runStarts[1]).toMatchObject({ sessionId: 'scoped-session' })
    expect(runStarts[1]).not.toHaveProperty('userId')
    expect(runStarts[2]).not.toHaveProperty('sessionId')
    expect(runStarts[2]).not.toHaveProperty('userId')
  })

  it('delivers every graph record type to subscribers in emission order', async () => {
    const recordTypes: string[] = []
    subscribeObservability((record) => {
      recordTypes.push(record.type)
    })

    await observe.run(
      { name: 'subscriber graph', rootPrimitive: 'custom.operation' },
      async () => {
        await observe.span(
          { name: 'producer', primitive: 'custom.operation' },
          async () => {
            observe.event({ name: 'phase' })
            const artifactId = observe.artifact({
              kind: 'output',
              contentType: 'application/json',
              encoding: 'json',
              preview: { ok: true },
            })
            observe.edge({
              edgeType: 'produced',
              from: {
                kind: 'span',
                id: observe.captureContext()!.currentSpanId!,
              },
              to: { kind: 'artifact', id: artifactId! },
            })
          },
        )
      },
    )

    expect(recordTypes).toEqual([
      'run:start',
      'span:start',
      'span:event',
      'artifact',
      'edge',
      'span:end',
      'run:end',
    ])
  })

  it('removes subscribers through the returned unsubscribe function', async () => {
    const records: string[] = []
    const unsubscribe = subscribeObservability((record) => {
      records.push(record.type)
    })

    unsubscribe()
    unsubscribe()
    await observe.run(
      { name: 'after unsubscribe', rootPrimitive: 'custom.operation' },
      async () => 'ok',
    )

    expect(records).toEqual([])
  })

  it('clears subscribers when the observability runtime resets', async () => {
    const records: string[] = []
    subscribeObservability((record) => {
      records.push(record.type)
    })

    resetObservabilityRuntime()
    await observe.run(
      { name: 'after reset', rootPrimitive: 'custom.operation' },
      async () => 'ok',
    )

    expect(records).toEqual([])
    expect(observabilityDiagnostics().subscriberErrors).toBe(0)
  })

  it('isolates throwing subscribers from sibling subscribers and transport delivery', async () => {
    const transport = createInMemoryObservabilityTransport()
    const siblingRecords: string[] = []
    setObservabilityTransport(transport)
    subscribeObservability(() => {
      throw new Error('subscriber failed')
    })
    subscribeObservability((record) => {
      siblingRecords.push(record.type)
    })

    await observe.run(
      { name: 'safe publish', rootPrimitive: 'custom.operation' },
      async () => 'ok',
    )
    await observe.flush()

    expect(siblingRecords).toEqual(['run:start', 'run:end'])
    expect(transport.records.map((record) => record.type)).toEqual([
      'run:start',
      'run:end',
    ])
    expect(observabilityDiagnostics()).toMatchObject({
      subscriberErrors: 2,
      deliveryErrors: [],
    })
  })

  it('publishes records to the diagnostics channel with the public message shape', async () => {
    const messages: CruxObservabilityChannelMessage[] = []
    const diagnosticsChannel = channel(CRUX_OBSERVABILITY_CHANNEL)
    const onMessage = (message: unknown) => {
      messages.push(message as CruxObservabilityChannelMessage)
    }
    diagnosticsChannel.subscribe(onMessage)

    try {
      await observe.run(
        { name: 'channel subscriber', rootPrimitive: 'custom.operation' },
        async () => {
          await observe.span(
            { name: 'channel span', primitive: 'custom.operation' },
            async () => 'ok',
          )
        },
      )
    } finally {
      diagnosticsChannel.unsubscribe(onMessage)
    }

    expect(messages.map((message) => message.schemaVersion)).toEqual([
      CRUX_OBSERVABILITY_SCHEMA_VERSION,
      CRUX_OBSERVABILITY_SCHEMA_VERSION,
      CRUX_OBSERVABILITY_SCHEMA_VERSION,
      CRUX_OBSERVABILITY_SCHEMA_VERSION,
    ])
    expect(messages.map((message) => message.record.type)).toEqual([
      'run:start',
      'span:start',
      'span:end',
      'run:end',
    ])
    expect(messages[0].record).toMatchObject({
      type: 'run:start',
      name: 'channel subscriber',
    })
  })

  it('preserves parent span across async work and captured context handoff', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    await observe.run(
      { name: 'async run', rootPrimitive: 'custom.operation' },
      async () => {
        await observe.span(
          { name: 'parent', primitive: 'custom.operation' },
          async () => {
            const captured = observe.captureContext()
            await new Promise((resolve) => setTimeout(resolve, 0))
            await observe.withContext(captured, async () => {
              await observe.span(
                { name: 'child', primitive: 'custom.operation' },
                async () => undefined,
              )
            })
          },
        )
      },
    )
    await observe.flush()

    const spanStarts = transport.records.filter(
      (record) => record.type === 'span:start',
    )
    expect(spanStarts).toHaveLength(2)
    expect(spanStarts[1].parentSpanId).toBe(spanStarts[0].spanId)
  })

  it('creates an implicit run for standalone spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    await observe.span(
      { name: 'standalone', primitive: 'custom.operation' },
      async () => 'ok',
    )
    await observe.flush()

    expect(transport.records.map((record) => record.type)).toEqual([
      'run:start',
      'span:start',
      'span:end',
      'run:end',
    ])
    expect(transport.records[0]).toMatchObject({
      type: 'run:start',
      rootPrimitive: 'custom.operation',
    })
  })

  it('can run standalone detail spans without creating a visible run', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const result = await observe.span(
      {
        name: 'router.resolve',
        primitive: 'routing.router',
        implicitRun: false,
      },
      async () => 'resolved',
    )
    const openSpan = observe.openSpan({
      name: 'cascade.resolve',
      primitive: 'routing.cascade',
      implicitRun: false,
    })
    expect(openSpan.segmentId).toMatch(/^seg_/)
    const openResult = await openSpan.withContext(async () => 'cascaded')
    openSpan.end()
    await observe.flush()

    expect(result).toBe('resolved')
    expect(openResult).toBe('cascaded')
    expect(transport.records).toEqual([])
  })

  it('supports manual run lifecycles for serverless resumes', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const run = observe.openRun({
      name: 'serverless swarm',
      rootPrimitive: 'composition.swarm',
    })
    expect(run.segmentId).toMatch(/^seg_/)
    const captured = run.captureContext()
    expect(captured.segmentId).toBe(run.segmentId)
    await run.withContext(async () => {
      await observe.span(
        { name: 'first turn', primitive: 'composition.swarm' },
        async () => undefined,
      )
    })

    await observe.withContext(captured, async () => {
      await observe.span(
        { name: 'second turn', primitive: 'composition.swarm' },
        async () => undefined,
      )
    })
    run.end()
    await observe.flush()

    expect(transport.records.map((record) => record.type)).toEqual([
      'run:start',
      'span:start',
      'span:end',
      'span:start',
      'span:end',
      'run:end',
    ])
    const [runStart, firstStart, , secondStart, , runEnd] = transport.records
    expect(run.segmentId).toBe(runStart.segmentId)
    expect(firstStart.segmentId).toBe(run.segmentId)
    expect(secondStart.segmentId).toBe(run.segmentId)
    expect(runEnd.segmentId).toBe(run.segmentId)
    expect(firstStart).toMatchObject({
      type: 'span:start',
      runId: runStart.runId,
      parentSpanId: null,
    })
    expect(secondStart).toMatchObject({
      type: 'span:start',
      runId: runStart.runId,
      parentSpanId: null,
    })
    expect(runEnd).toMatchObject({
      type: 'run:end',
      runId: runStart.runId,
      status: 'ok',
    })
  })

  it('does not synthesize segment ids for incomplete captured contexts', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const run = observe.openRun({
      name: 'incomplete context',
      rootPrimitive: 'custom.operation',
    })
    const { segmentId: _removedSegmentId, ...incompleteContext } =
      run.captureContext()

    await observe.withContext(
      incompleteContext as unknown as CapturedObservabilityContext,
      async () => {
        const span = observe.openSpan({
          name: 'missing segment',
          primitive: 'custom.operation',
        })
        span.end()
      },
    )
    await observe.flush()

    expect(transport.records).toEqual([
      expect.objectContaining({
        type: 'run:start',
        runId: run.runId,
        segmentId: run.segmentId,
      }),
    ])
    expect(observabilityDiagnostics().invalidRecords).toBeGreaterThan(0)
  })

  it('emits captured run ends once with captured duration', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T00:00:00.000Z'))
    try {
      const transport = createInMemoryObservabilityTransport()
      setObservabilityTransport(transport)

      const run = observe.openRun({
        name: 'serverless once',
        rootPrimitive: 'custom.operation',
      })
      const captured = run.captureContext()

      vi.advanceTimersByTime(42)
      run.end()
      run.error(new Error('late duplicate'), {
      })
      await observe.flush()

      const runEnds = transport.records.filter(
        (record) => record.type === 'run:end',
      )
      expect(runEnds).toHaveLength(1)
      expect(runEnds[0]).toMatchObject({
        type: 'run:end',
        runId: run.runId,
        status: 'ok',
        durationMs: 42,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('deduplicates repeated owner terminal calls', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const first = observe.openRun({
      name: 'owner first',
      rootPrimitive: 'custom.operation',
    })
    first.end()
    first.error(new Error('duplicate'))

    const second = observe.openRun({
      name: 'captured first',
      rootPrimitive: 'custom.operation',
    })
    second.end()
    second.error(new Error('duplicate'))

    await observe.flush()

    const runEnds = transport.records.filter(
      (record) => record.type === 'run:end',
    )
    expect(runEnds).toHaveLength(2)
    expect(runEnds.map((record) => record.status)).toEqual(['ok', 'ok'])
    expect(runEnds.map((record) => record.runId)).toEqual([
      first.runId,
      second.runId,
    ])
  })

  it('suspends an owner before a fresh segment emits the terminal end', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const run = observe.openRun({
      name: 'resumable flow',
      rootPrimitive: 'flow.run',
    })
    const continuation = run.suspend({ reason: 'await-signal' })
    const resumed = observe.resumeRun(continuation, { reason: 'signal' })
    resumed.end()
    resumed.error(new Error('duplicate terminal end'))
    await observe.flush()

    expect(transport.records.map((record) => record.type)).toEqual([
      'run:start',
      'run:suspend',
      'run:resume',
      'run:end',
    ])
    expect(resumed.runId).toBe(run.runId)
  })

  it('merges open span attributes with setAttributes and explicit end attributes', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const run = observe.openRun({
      name: 'manual attrs',
      rootPrimitive: 'custom.operation',
    })
    run.withContext(() => {
      const span = observe.openSpan({
        name: 'manual span',
        primitive: 'custom.operation',
        attributes: { initial: true, phase: 'start' },
      })
      span.setAttributes({ phase: 'middle', accumulated: 1 })
      span.end({ attributes: { final: true } })
    })
    run.end()
    await observe.flush()

    const spanEnd = transport.records.find(
      (record) => record.type === 'span:end',
    )
    expect(spanEnd).toMatchObject({
      type: 'span:end',
      attributes: {
        initial: true,
        phase: 'middle',
        accumulated: 1,
        final: true,
      },
    })
  })

  it('treats an untyped end error field as an error end instead of raw attributes', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const run = observe.openRun({
      name: 'manual error option',
      rootPrimitive: 'custom.operation',
    })
    run.withContext(() => {
      const span = observe.openSpan({
        name: 'manual span',
        primitive: 'custom.operation',
      })
      span.end({ error: 'someString' })
    })
    run.end()
    await observe.flush()

    const spanEnd = transport.records.find(
      (record) => record.type === 'span:end',
    )
    expect(spanEnd).toMatchObject({
      type: 'span:end',
      status: 'error',
      error: { message: 'someString' },
    })
    expect(spanEnd).not.toMatchObject({
      attributes: expect.objectContaining({ error: 'someString' }),
    })
  })

  it('emits events, artifacts, and edges inside the active span', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    await observe.run(
      { name: 'artifact run', rootPrimitive: 'custom.operation' },
      async () => {
        await observe.span(
          { name: 'producer', primitive: 'custom.operation' },
          async () => {
            observe.event({ name: 'phase', attributes: { value: 'started' } })
            const artifactId = createCruxArtifactId()
            observe.artifact({
              artifactId,
              kind: 'output',
              contentType: 'application/json',
              encoding: 'json',
              preview: { ok: true },
            })
            observe.edge({
              edgeType: 'produced',
              from: {
                kind: 'span',
                id: observe.captureContext().currentSpanId!,
              },
              to: { kind: 'artifact', id: artifactId },
            })
          },
        )
      },
    )
    await observe.flush()

    expect(transport.records.map((record) => record.type)).toEqual([
      'run:start',
      'span:start',
      'span:event',
      'artifact',
      'edge',
      'span:end',
      'run:end',
    ])
    expect(transport.records[2]).toMatchObject({
      type: 'span:event',
      name: 'phase',
    })
    expect(transport.records[3]).toMatchObject({
      type: 'artifact',
      kind: 'output',
    })
    expect(transport.records[4]).toMatchObject({
      type: 'edge',
      edgeType: 'produced',
    })
    expectBalancedGraph(transport.records)
  })

  it('records transport failures without throwing user code', async () => {
    setObservabilityTransport({
      async send() {
        throw new Error('collector offline')
      },
    })

    await expect(
      observe.run(
        { name: 'non throwing', rootPrimitive: 'custom.operation' },
        async () => 'still works',
      ),
    ).resolves.toBe('still works')
    await observe.flush()

    expect(observabilityDeliveryErrors().length).toBeGreaterThanOrEqual(2)
  })

  it('emits terminal error records and rethrows user errors', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const error = new Error('bad plan')
    error.stack = 'Error: bad plan\n    at failing test'
    Object.assign(error, { token: 'secret-token' })

    await expect(
      observe.run(
        { name: 'failing run', rootPrimitive: 'custom.operation' },
        async () => {
          await observe.span(
            { name: 'failing span', primitive: 'custom.operation' },
            async () => {
              throw error
            },
          )
        },
      ),
    ).rejects.toThrow('bad plan')
    await observe.flush()

    expect(transport.records.map((record) => record.type)).toEqual([
      'run:start',
      'span:start',
      'span:event',
      'artifact',
      'artifact',
      'span:end',
      'run:end',
    ])
    expect(transport.records[2]).toMatchObject({
      type: 'span:event',
      name: 'exception',
      attributes: {
        'exception.message': 'bad plan',
        'exception.type': 'Error',
        'exception.stacktrace': expect.stringContaining('bad plan'),
      },
    })
    expect(transport.records[3]).toMatchObject({
      type: 'artifact',
      kind: 'error.stack',
      contentType: 'text/plain',
      encoding: 'text',
      preview: expect.stringContaining('bad plan'),
    })
    expect(transport.records[4]).toMatchObject({
      type: 'artifact',
      kind: 'error.raw',
      contentType: 'application/json',
      encoding: 'json',
      preview: {
        message: 'bad plan',
        name: 'Error',
        token: '[redacted]',
      },
    })
    expect(transport.records[5]).toMatchObject({
      type: 'span:end',
      status: 'error',
      error: { message: 'bad plan', name: 'Error' },
    })
    expect(transport.records[6]).toMatchObject({
      type: 'run:end',
      status: 'error',
      error: { message: 'bad plan', name: 'Error' },
    })
  })

  it('emits rich error evidence for manually errored open spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const error = new Error('manual failure')
    error.stack = 'Error: manual failure\n    at open span'

    const run = observe.openRun({
      name: 'manual run',
      rootPrimitive: 'custom.operation',
    })
    run.withContext(() => {
      const span = observe.openSpan({
        name: 'manual span',
        primitive: 'custom.operation',
      })
      span.error(error, { phase: 'manual.finish', errorKind: 'manual_error' })
    })
    run.end()
    await observe.flush()

    expect(transport.records.map((record) => record.type)).toEqual([
      'run:start',
      'span:start',
      'span:event',
      'artifact',
      'artifact',
      'span:end',
      'run:end',
    ])
    expect(transport.records[2]).toMatchObject({
      type: 'span:event',
      name: 'exception',
      attributes: {
        'exception.message': 'manual failure',
        'exception.type': 'Error',
        'exception.stacktrace': expect.stringContaining('manual failure'),
        'error.phase': 'manual.finish',
        'error.kind': 'manual_error',
      },
    })
    expect(transport.records[5]).toMatchObject({
      type: 'span:end',
      status: 'error',
      error: {
        message: 'manual failure',
        name: 'Error',
        category: 'manual_error',
      },
      attributes: { phase: 'manual.finish', errorKind: 'manual_error' },
    })
  })

  it('flushes pending background deliveries for serverless shutdown paths', async () => {
    const delivered: string[] = []
    setObservabilityTransport({
      async send(records) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        delivered.push(...records.map((record) => record.type))
        return acceptedDeliveryReceipt(records)
      },
    })

    await observe.run(
      { name: 'serverless', rootPrimitive: 'custom.operation' },
      async () => 'ok',
    )

    expect(delivered).toEqual([])
    await expect(observe.flush()).resolves.toMatchObject({ status: 'drained' })
    expect(delivered).toEqual(['run:start', 'run:end'])
  })

  it('calls the transport flush hook after queued records drain', async () => {
    const delivered: string[] = []
    const flush = vi.fn<() => Promise<void>>(async () => {
      delivered.push('flush')
    })
    setObservabilityTransport({
      send(records) {
        delivered.push(...records.map((record) => record.type))
        return acceptedDeliveryReceipt(records)
      },
      flush,
    })

    await observe.run(
      { name: 'flush hook', rootPrimitive: 'custom.operation' },
      async () => 'ok',
    )

    await expect(observe.flush()).resolves.toMatchObject({ status: 'drained' })
    expect(flush).toHaveBeenCalledTimes(1)
    expect(delivered).toEqual(['run:start', 'run:end', 'flush'])
  })

  it('starts the first delivery after the batching window', async () => {
    vi.useFakeTimers()
    try {
      const send = vi.fn(acceptedDeliveryReceipt)
      setObservabilityTransport({ send })

      observe.openRun({ name: 'live run', rootPrimitive: 'custom.operation' })

      expect(send).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(199)
      expect(send).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0][0]).toEqual([
        expect.objectContaining({ type: 'run:start', name: 'live run' }),
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('dispatches queued live deliveries while an earlier send is still in flight', async () => {
    let resolveFirstSend!: () => void
    const sentBatches: string[][] = []
    setObservabilityTransport(
      {
        async send(records) {
          sentBatches.push(records.map((record) => record.type))
          if (sentBatches.length === 1) {
            await new Promise<void>((resolve) => {
              resolveFirstSend = resolve
            })
          }
          return acceptedDeliveryReceipt(records)
        },
      },
      { scheduledDelayMs: 0 },
    )

    const run = observe.openRun({
      name: 'live stream',
      rootPrimitive: 'custom.operation',
    })
    run.withContext(() => {
      const span = observe.openSpan({
        name: 'child',
        primitive: 'custom.operation',
      })
      span.end()
    })
    await new Promise((resolve) => queueMicrotask(resolve))

    expect(sentBatches.flat()).toEqual(['run:start', 'span:start', 'span:end'])
    resolveFirstSend()
    await observe.flush()
    expect(sentBatches.flat()).toEqual(['run:start', 'span:start', 'span:end'])
  })

  it('flushes queued deliveries before the batching window elapses', async () => {
    const sentBatches: string[][] = []
    setObservabilityTransport({
      send(records) {
        sentBatches.push(records.map((record) => record.type))
        return acceptedDeliveryReceipt(records)
      },
    })

    const run = observe.openRun({
      name: 'convex cleanup',
      rootPrimitive: 'runtime.convex.action',
    })
    run.withContext(() => {
      const span = observe.openSpan({
        name: 'cleanup',
        primitive: 'runtime.convex.action',
      })
      span.end()
    })
    await expect(observe.flush()).resolves.toMatchObject({ status: 'drained' })

    expect(sentBatches.flat()).toEqual(['run:start', 'span:start', 'span:end'])
  })

  it('keeps live delivery concurrency bounded while allowing progress behind slow sends', async () => {
    let activeSends = 0
    let maxActiveSends = 0
    const delivered: string[] = []
    setObservabilityTransport(
      {
        async send(records) {
          activeSends += 1
          maxActiveSends = Math.max(maxActiveSends, activeSends)
          await new Promise((resolve) => setTimeout(resolve, 1))
          delivered.push(...records.map((record) => record.type))
          activeSends -= 1
          return acceptedDeliveryReceipt(records)
        },
      },
      { maxPendingDeliveries: 3, scheduledDelayMs: 0 },
    )

    await observe.run(
      { name: 'fanout', rootPrimitive: 'custom.operation' },
      async () => {
        await Promise.all(
          Array.from({ length: 8 }, (_, index) =>
            observe.span(
              { name: `branch ${index}`, primitive: 'custom.operation' },
              async () => index,
            ),
          ),
        )
      },
    )
    await observe.flush()

    expect(maxActiveSends).toBeGreaterThan(1)
    expect(maxActiveSends).toBeLessThanOrEqual(3)
    expect(delivered.filter((type) => type === 'span:start')).toHaveLength(8)
    expect(delivered.filter((type) => type === 'span:end')).toHaveLength(8)
    expect(delivered).toContain('run:start')
    expect(delivered).toContain('run:end')
  })

  it('bounds flush waits so collector hangs never hang user code', async () => {
    setObservabilityTransport({
      async send() {
        await new Promise(() => undefined)
      },
    })

    await observe.run(
      { name: 'hung collector', rootPrimitive: 'custom.operation' },
      async () => 'ok',
    )

    await expect(observe.flush({ timeoutMs: 1 })).resolves.toMatchObject({
      status: 'deadline',
      deadlineExceeded: true,
    })
    expect(observabilityDiagnostics().pendingDeliveries).toBeGreaterThan(0)
  })

  it('retries failed delivery batches during flush instead of dropping them', async () => {
    let failNextSend = true
    const delivered: string[] = []
    setObservabilityTransport(
      {
        async send(records) {
          if (failNextSend) {
            failNextSend = false
            throw new Error('temporary ingest outage')
          }
          delivered.push(...records.map((record) => record.type))
          return acceptedDeliveryReceipt(records)
        },
      },
      { maxPendingDeliveries: 1 },
    )

    await observe.run(
      { name: 'retry queued batch', rootPrimitive: 'custom.operation' },
      async () => 'ok',
    )

    await expect(observe.flush()).resolves.toMatchObject({ status: 'drained' })
    expect(delivered).toEqual(['run:start', 'run:end'])
    expect(observabilityDiagnostics().deliveryErrors).toHaveLength(1)
  })

  it('contains synchronous transport throws and keeps the failed batch queued', async () => {
    const chaos = chaosTransport('sync-throw')
    setObservabilityTransport(chaos.transport, {
      maxPendingDeliveries: 1,
      scheduledDelayMs: 0,
      retryDelayMs: 0,
      maxRetryDelayMs: 0,
    })

    await expect(
      observe.run(
        { name: 'sync throw transport', rootPrimitive: 'custom.operation' },
        async () => 'ok',
      ),
    ).resolves.toBe('ok')

    expect(chaos.sendCount).toBeGreaterThan(0)
    expect(observabilityDiagnostics().deliveryErrors).toHaveLength(
      chaos.sendCount,
    )

    chaos.setMode('slow')
    const sendsBeforeFlush = chaos.sendCount
    const flushed = observe.flush()
    while (chaos.sendCount === sendsBeforeFlush) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    chaos.resolveSlowDeliveries()

    await expect(flushed).resolves.toMatchObject({ status: 'drained' })
    expect(chaos.batches.at(-1)?.map((record) => record.type)).toEqual([
      'run:start',
      'run:end',
    ])
  })

  it('cancels bounded flush timers when delivery completes before the deadline', async () => {
    vi.useFakeTimers()
    try {
      let resolveSend!: () => void
      setObservabilityTransport({
        async send(records) {
          await new Promise<void>((resolve) => {
            resolveSend = resolve
          })
          return acceptedDeliveryReceipt(records)
        },
      })

      observe.openRun({
        name: 'bounded flush',
        rootPrimitive: 'custom.operation',
      })
      const flushed = observe.flush({ timeoutMs: 60_000 })
      await Promise.resolve()
      resolveSend()

      await expect(flushed).resolves.toMatchObject({ status: 'drained' })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops the oldest queued records when a hung transport fills the bounded queue', async () => {
    const chaos = chaosTransport('hang')
    setObservabilityTransport(chaos.transport, {
      maxPendingDeliveries: 1,
      maxQueuedRecords: 2048,
      scheduledDelayMs: 0,
    })

    const run = observe.openRun({
      name: 'pressure',
      rootPrimitive: 'custom.operation',
    })
    run.withContext(() => {
      const span = observe.openSpan({
        name: 'buffered span',
        primitive: 'custom.operation',
      })
      span.withContext(() => {
        for (let index = 0; index < 4997; index += 1) {
          observe.event({ name: `event ${index}` })
        }
      })
      span.end()
    })

    expect(observabilityDiagnostics()).toMatchObject({
      pendingDeliveries: 1,
      droppedRecords: 2952,
    })

    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, {
      maxPendingDeliveries: 2,
      maxQueuedRecords: 2048,
      scheduledDelayMs: 0,
    })

    await expect(observe.flush()).resolves.toMatchObject({
      status: 'drained',
    })
    expect(transport.records).toHaveLength(2047)
    expect(transport.records[0]).toMatchObject({
      type: 'span:event',
      name: 'event 2951',
    })
    expect(transport.records.at(-1)).toMatchObject({ type: 'span:end' })
  })

  it('counts queued records discarded after the transport is removed', async () => {
    const chaos = chaosTransport('hang')
    setObservabilityTransport(chaos.transport, {
      maxPendingDeliveries: 1,
      maxQueuedRecords: 16,
      scheduledDelayMs: 0,
    })

    const run = observe.openRun({
      name: 'remove transport',
      rootPrimitive: 'custom.operation',
    })
    run.withContext(() => {
      const span = observe.openSpan({
        name: 'queued',
        primitive: 'custom.operation',
      })
      span.end()
    })
    setObservabilityTransport(undefined)

    await expect(observe.flush({ timeoutMs: 1 })).resolves.toMatchObject({
      status: 'drained',
    })
    expect(observabilityDiagnostics()).toMatchObject({
      pendingDeliveries: 0,
      droppedRecords: 3,
    })
  })

  it('counts queued records discarded by runtime reset', () => {
    const chaos = chaosTransport('hang')
    setObservabilityTransport(chaos.transport, {
      maxPendingDeliveries: 1,
      maxQueuedRecords: 16,
      scheduledDelayMs: 0,
    })

    const run = observe.openRun({
      name: 'reset drops',
      rootPrimitive: 'custom.operation',
    })
    run.withContext(() => {
      const span = observe.openSpan({
        name: 'queued reset span',
        primitive: 'custom.operation',
      })
      span.end()
    })

    resetObservabilityRuntime()
    expect(observabilityDiagnostics()).toMatchObject({
      pendingDeliveries: 0,
      droppedRecords: 2,
    })
  })

  it('keeps memory bounded during a 100k-record hung-transport soak', () => {
    const chaos = chaosTransport('hang')
    setObservabilityTransport(chaos.transport, {
      maxPendingDeliveries: 1,
      maxQueuedRecords: 2048,
      scheduledDelayMs: 0,
    })

    const run = observe.openRun({
      name: 'soak',
      rootPrimitive: 'custom.operation',
    })
    run.withContext(() => {
      const span = observe.openSpan({
        name: 'soak span',
        primitive: 'custom.operation',
      })
      span.withContext(() => {
        for (let index = 0; index < 99_997; index += 1) {
          observe.event({ name: `event ${index}` })
        }
      })
      span.end()
    })

    expect(observabilityDiagnostics()).toMatchObject({
      pendingDeliveries: 1,
      droppedRecords: 97_952,
    })
  }, 60_000)

  it('posts canonical batches through the HTTP transport', async () => {
    const fetchImpl = vi.fn<typeof fetch>(acceptedHttpResponse)
    const transport = createHttpObservabilityTransport({
      serverUrl: 'ws://localhost:4400/',
      fetch: fetchImpl,
      headers: { 'X-Crux-Route': 'test' },
      timeoutMs: 100,
    })
    setObservabilityTransport(transport)

    await observe.run(
      { name: 'http run', rootPrimitive: 'custom.operation' },
      async () => 'ok',
    )
    await observe.flush()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://localhost:4400/api/observability/records',
    )
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true',
        'X-Crux-Route': 'test',
      },
    })
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
      records: [{ type: 'run:start', name: 'http run' }, { type: 'run:end' }],
    })
  })

  it('preserves tokenized tunnel query params on HTTP transport endpoints', async () => {
    const fetchImpl = vi.fn<typeof fetch>(acceptedHttpResponse)
    const transport = createHttpObservabilityTransport({
      serverUrl: 'https://example.ngrok.app?t=session-token',
      fetch: fetchImpl,
      timeoutMs: 100,
    })
    setObservabilityTransport(transport)

    await observe.run(
      { name: 'tunnel run', rootPrimitive: 'custom.operation' },
      async () => 'ok',
    )
    await observe.flush()

    expect(fetchImpl).toHaveBeenCalled()
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://example.ngrok.app/api/observability/records?t=session-token',
    )
  })

  it('sends bearer auth from an HTTP transport token option', async () => {
    const fetchImpl = vi.fn<typeof fetch>(acceptedHttpResponse)
    const transport = createHttpObservabilityTransport({
      serverUrl: 'https://example.ngrok.app',
      token: 'project-ingest-token',
      fetch: fetchImpl,
      timeoutMs: 100,
    })
    setObservabilityTransport(transport)

    await observe.run(
      { name: 'bearer run', rootPrimitive: 'custom.operation' },
      async () => 'ok',
    )
    await observe.flush()

    expect(fetchImpl).toHaveBeenCalled()
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer project-ingest-token',
    })
  })

  it('uses CRUX_DEVTOOLS_TOKEN as the default HTTP transport bearer token', async () => {
    const previous = process.env.CRUX_DEVTOOLS_TOKEN
    process.env.CRUX_DEVTOOLS_TOKEN = 'env-ingest-token'
    try {
      const fetchImpl = vi.fn<typeof fetch>(acceptedHttpResponse)
      const transport = createHttpObservabilityTransport({
        serverUrl: 'https://example.ngrok.app',
        fetch: fetchImpl,
        timeoutMs: 100,
      })
      setObservabilityTransport(transport)

      await observe.run(
        { name: 'env bearer run', rootPrimitive: 'custom.operation' },
        async () => 'ok',
      )
      await observe.flush()

      expect(fetchImpl).toHaveBeenCalled()
      expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
        Authorization: 'Bearer env-ingest-token',
      })
    } finally {
      if (previous === undefined) {
        delete process.env.CRUX_DEVTOOLS_TOKEN
      } else {
        process.env.CRUX_DEVTOOLS_TOKEN = previous
      }
    }
  })

  it('retries transient HTTP ingest failures before dropping observability batches', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>(acceptedHttpResponse)
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
    const transport = createHttpObservabilityTransport({
      serverUrl: 'http://localhost:4400',
      fetch: fetchImpl,
    })
    setObservabilityTransport(transport)

    await observe.run(
      { name: 'retry run', rootPrimitive: 'custom.operation' },
      async () => 'ok',
    )
    await expect(observe.flush()).resolves.toMatchObject({ status: 'drained' })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(observabilityDeliveryErrors()).toEqual([
      expect.objectContaining({ code: 'delivery_retry' }),
    ])
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toMatchObject({
      sourceHealth: {
        retried: 2,
        lastError: { code: 'delivery_retry' },
      },
    })
    const deliveredRecordTypes = fetchImpl.mock.calls
      .slice(1)
      .flatMap((call) =>
        JSON.parse(String(call[1]?.body)).records.map(
          (record: { type: string }) => record.type,
        ),
      )
    expect(deliveredRecordTypes).toContain('run:start')
    expect(deliveredRecordTypes).toContain('run:end')
  })

  it('does not isolate HTTP records one-by-one for retryable 5xx responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('busy', { status: 503 }),
    )
    const transport = createHttpObservabilityTransport({
      serverUrl: 'http://localhost:4400',
      fetch: fetchImpl,
    })
    const firstRecord = {
      schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
      recordId: 'rec_5xx_first',
      segmentId: 'seg_5xx_retry',
      segmentSeq: 1,
      type: 'run:start',
      runId: 'run_5xx_retry',
      traceId: 'trace_5xx_retry',
      name: 'retryable',
      rootPrimitive: 'custom.operation',
      startedAt: '2026-05-16T18:00:00.000Z',
      status: 'running',
    } as unknown as CruxGraphRecord
    const secondRecord = {
      schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
      recordId: 'rec_5xx_second',
      segmentId: 'seg_5xx_retry',
      segmentSeq: 2,
      type: 'run:end',
      runId: 'run_5xx_retry',
      traceId: 'trace_5xx_retry',
      endedAt: '2026-05-16T18:00:00.010Z',
      durationMs: 10,
      status: 'error',
    } as unknown as CruxGraphRecord

    await expect(
      transport.send([firstRecord, secondRecord]),
    ).resolves.toMatchObject({
      dispositions: [
        expect.objectContaining({ index: 0, retryable: true }),
        expect.objectContaining({ index: 1, retryable: true }),
      ],
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      schemaVersion: 2,
      records: [firstRecord, secondRecord],
    })
  })

  it('keeps terminal lifecycle records deliverable when late previews contain JSON-hostile values', async () => {
    const fetchImpl = vi.fn<typeof fetch>(acceptedHttpResponse)
    const transport = createHttpObservabilityTransport({
      serverUrl: 'http://localhost:4400',
      fetch: fetchImpl,
    })
    setObservabilityTransport(transport)

    await observe.run(
      { name: 'json hostile preview', rootPrimitive: 'custom.operation' },
      async () => {
        await observe.span(
          { name: 'producer', primitive: 'custom.operation' },
          async () => {
            const cyclic: Record<string, unknown> = { id: 'cyclic' }
            cyclic.self = cyclic
            observe.artifact({
              kind: 'output',
              contentType: 'application/json',
              encoding: 'json',
              preview: {
                count: 1n,
                cyclic,
              },
            })
          },
        )
      },
    )
    await expect(observe.flush()).resolves.toMatchObject({ status: 'drained' })

    const deliveredRecords = fetchImpl.mock.calls.flatMap(
      (call) => JSON.parse(String(call[1]?.body)).records,
    )
    expect(
      deliveredRecords.map((record: { type: string }) => record.type),
    ).toContain('span:end')
    expect(
      deliveredRecords.map((record: { type: string }) => record.type),
    ).toContain('run:end')
    const artifact = deliveredRecords.find(
      (record: { type: string }) => record.type === 'artifact',
    )
    expect(artifact.preview).toMatchObject({
      count: '1',
      cyclic: { id: 'cyclic', self: '[Circular]' },
    })
    expect(observabilityDeliveryErrors()).toHaveLength(0)
  })

  it('uses indexed HTTP dispositions so one bad detail cannot strand terminal records', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const records = JSON.parse(String(init?.body)).records as Array<{
        type: string
        name?: string
      }>
      return new Response(
        JSON.stringify({
          dispositions: records.map((record, index) => ({
            index,
            recordId: (record as { recordId: string }).recordId,
            outcome: record.type === 'artifact' ? 'rejected' : 'accepted',
            code: record.type === 'artifact' ? 'invalid_record' : 'accepted',
            retryable: false,
          })),
        }),
        { status: 202 },
      )
    })
    const transport = createHttpObservabilityTransport({
      serverUrl: 'http://localhost:4400',
      fetch: fetchImpl,
      maxRecordsPerRequest: 100,
    })
    setObservabilityTransport(transport)

    await observe.run(
      { name: 'partially bad batch', rootPrimitive: 'custom.operation' },
      async () => {
        await observe.span(
          { name: 'producer', primitive: 'custom.operation' },
          async () => {
            observe.artifact({
              kind: 'output',
              contentType: 'application/json',
              encoding: 'json',
              preview: { validClientSide: true },
            })
          },
        )
      },
    )
    await expect(observe.flush()).resolves.toMatchObject({ status: 'drained' })

    const deliveredRecords = fetchImpl.mock.calls
      .map(
        (call) =>
          JSON.parse(String(call[1]?.body)).records as Array<{ type: string }>,
      )
      .flat()
    expect(deliveredRecords.map((record) => record.type)).toContain('span:end')
    expect(deliveredRecords.map((record) => record.type)).toContain('run:end')
    expect(observabilityDiagnostics()).toMatchObject({
      permanentlyRejectedRecords: 1,
      droppedRecords: 1,
    })
  })

  it('does not locally Zod-parse HTTP batches before posting them', async () => {
    const fetchImpl = vi.fn<typeof fetch>(acceptedHttpResponse)
    const transport = createHttpObservabilityTransport({
      serverUrl: 'http://localhost:4400',
      fetch: fetchImpl,
    })
    const malformedButAlreadyAcceptedRecord = {
      schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
      recordId: 'rec_invalid_local_parse',
      segmentId: 'seg_invalid_local_parse',
      segmentSeq: 1,
      type: 'run:start',
      runId: 'run_invalid_local_parse',
      traceId: 'trace-not-w3c',
      name: 'invalid local parse',
      rootPrimitive: 'custom.operation',
      startedAt: '2026-05-16T18:00:00.000Z',
      status: 'running',
    } as unknown as CruxGraphRecord

    await expect(
      transport.send([malformedButAlreadyAcceptedRecord]),
    ).resolves.toMatchObject({
      dispositions: [expect.objectContaining({ outcome: 'accepted' })],
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      schemaVersion: 2,
      records: [malformedButAlreadyAcceptedRecord],
    })
  })

  it('chunks large HTTP deliveries in the engine without treating the record list as a preview array', async () => {
    const fetchImpl = vi.fn<typeof fetch>(acceptedHttpResponse)
    const transport = createHttpObservabilityTransport({
      serverUrl: 'http://localhost:4400',
      fetch: fetchImpl,
      maxRecordsPerRequest: 50,
    })
    setObservabilityTransport(transport)

    const run = observe.openRun({
      name: 'chunked http run',
      rootPrimitive: 'custom.operation',
    })
    run.withContext(() => {
      for (let index = 0; index < 203; index += 1) {
        observe.artifact({
          kind: 'output',
          contentType: 'application/json',
          encoding: 'json',
          preview: { index },
        })
      }
    })
    run.end()
    await observe.flush()

    const deliveredCount = fetchImpl.mock.calls.reduce((count, call) => {
      return count + JSON.parse(String(call[1]?.body)).records.length
    }, 0)
    expect(fetchImpl).toHaveBeenCalledTimes(5)
    expect(deliveredCount).toBe(205)
  })

  it('shutdown flushes bounded deliveries and disables later sends', async () => {
    const transport = {
      ...createInMemoryObservabilityTransport(),
      shutdown: vi.fn(async () => undefined),
    }
    setObservabilityTransport(transport)

    await observe.run(
      { name: 'before shutdown', rootPrimitive: 'custom.operation' },
      async () => 'ok',
    )
    await expect(observe.shutdown()).resolves.toMatchObject({ status: 'drained' })
    await observe.run(
      { name: 'after shutdown', rootPrimitive: 'custom.operation' },
      async () => 'ok',
    )
    await observe.flush()

    expect(transport.shutdown).toHaveBeenCalledTimes(1)
    expect(transport.records.map((record) => record.type)).toEqual([
      'run:start',
      'run:end',
    ])
  })
})

async function acceptedHttpResponse(
  _input: URL | RequestInfo,
  init?: RequestInit,
): Promise<Response> {
  const records = JSON.parse(String(init?.body)).records as CruxGraphRecord[]
  return new Response(
    JSON.stringify({ accepted: records.length, rejected: [] }),
    { status: 202 },
  )
}
