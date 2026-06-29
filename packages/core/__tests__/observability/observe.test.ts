import { afterEach, describe, expect, it, vi } from 'vitest'
import { channel } from 'node:diagnostics_channel'
import {
  CRUX_OBSERVABILITY_CHANNEL,
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  type CruxObservabilityChannelMessage,
  createHttpObservabilityTransport,
  createCruxArtifactId,
  createInMemoryObservabilityTransport,
  observe,
  observabilityDiagnostics,
  observabilityDeliveryErrors,
  resetObservabilityRuntime,
  setObservabilityTransport,
  subscribeObservability,
} from '../../observability'

describe('observe runtime', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

    it('emits run and span lifecycle records through the configured transport', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const result = await observe.run({ name: 'support reply', rootPrimitive: 'custom.operation' }, async () => {
      return await observe.span(
        { name: 'prepare context', family: 'custom', primitive: 'custom.operation' },
        async () => {
          return 'done'
        },
      )
    })

    await observe.flush()

    expect(result).toBe('done')
    expect(transport.records.map((record) => record.type)).toEqual(['run:start', 'span:start', 'span:end', 'run:end'])

    const [runStart, spanStart, spanEnd, runEnd] = transport.records
    expect(runStart).toMatchObject({ type: 'run:start', name: 'support reply', status: 'running' })
    expect(spanStart).toMatchObject({
      type: 'span:start',
      runId: runStart.runId,
      traceId: runStart.traceId,
      family: 'custom',
      primitive: 'custom.operation',
      status: 'running',
    })
    expect(spanEnd).toMatchObject({ type: 'span:end', runId: runStart.runId, spanId: spanStart.spanId, status: 'ok' })
    expect(runEnd).toMatchObject({ type: 'run:end', runId: runStart.runId, traceId: runStart.traceId, status: 'ok' })
  })

    it('delivers records to subscribers without a configured transport', async () => {
    const records: string[] = []
    subscribeObservability((record) => {
      records.push(record.type)
    })

    await observe.run({ name: 'subscriber only', rootPrimitive: 'custom.operation' }, async () => 'ok')

    expect(records).toEqual(['run:start', 'run:end'])
    expect(observabilityDiagnostics()).toMatchObject({
      pendingDeliveries: 0,
      droppedRecords: 0,
      subscriberErrors: 0,
    })
  })

    it('delivers every graph record type to subscribers in emission order', async () => {
    const recordTypes: string[] = []
    subscribeObservability((record) => {
      recordTypes.push(record.type)
    })

    await observe.run({ name: 'subscriber graph', rootPrimitive: 'custom.operation' }, async () => {
      await observe.span({ name: 'producer', family: 'custom', primitive: 'custom.operation' }, async () => {
        observe.event({ name: 'phase' })
        const artifactId = observe.artifact({
          kind: 'output',
          contentType: 'application/json',
          encoding: 'json',
          preview: { ok: true },
        })
        observe.edge({
          edgeType: 'produced',
          from: { kind: 'span', id: observe.captureContext()!.currentSpanId! },
          to: { kind: 'artifact', id: artifactId! },
        })
      })
    })

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
    await observe.run({ name: 'after unsubscribe', rootPrimitive: 'custom.operation' }, async () => 'ok')

    expect(records).toEqual([])
  })

    it('clears subscribers when the observability runtime resets', async () => {
    const records: string[] = []
    subscribeObservability((record) => {
      records.push(record.type)
    })

    resetObservabilityRuntime()
    await observe.run({ name: 'after reset', rootPrimitive: 'custom.operation' }, async () => 'ok')

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

    await observe.run({ name: 'safe publish', rootPrimitive: 'custom.operation' }, async () => 'ok')
    await observe.flush()

    expect(siblingRecords).toEqual(['run:start', 'run:end'])
    expect(transport.records.map((record) => record.type)).toEqual(['run:start', 'run:end'])
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
      await observe.run({ name: 'channel subscriber', rootPrimitive: 'custom.operation' }, async () => {
        await observe.span({ name: 'channel span', family: 'custom', primitive: 'custom.operation' }, async () => 'ok')
      })
    } finally {
      diagnosticsChannel.unsubscribe(onMessage)
    }

    expect(messages.map((message) => message.schemaVersion)).toEqual([
      CRUX_OBSERVABILITY_SCHEMA_VERSION,
      CRUX_OBSERVABILITY_SCHEMA_VERSION,
      CRUX_OBSERVABILITY_SCHEMA_VERSION,
      CRUX_OBSERVABILITY_SCHEMA_VERSION,
    ])
    expect(messages.map((message) => message.record.type)).toEqual(['run:start', 'span:start', 'span:end', 'run:end'])
    expect(messages[0].record).toMatchObject({
      type: 'run:start',
      name: 'channel subscriber',
    })
  })

    it('preserves parent span across async work and captured context handoff', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    await observe.run({ name: 'async run', rootPrimitive: 'custom.operation' }, async () => {
      await observe.span({ name: 'parent', family: 'custom', primitive: 'custom.operation' }, async () => {
        const captured = observe.captureContext()
        await new Promise((resolve) => setTimeout(resolve, 0))
        await observe.withContext(captured, async () => {
          await observe.span({ name: 'child', family: 'custom', primitive: 'custom.operation' }, async () => undefined)
        })
      })
    })
    await observe.flush()

    const spanStarts = transport.records.filter((record) => record.type === 'span:start')
    expect(spanStarts).toHaveLength(2)
    expect(spanStarts[1].parentSpanId).toBe(spanStarts[0].spanId)
  })

    it('creates an implicit run for standalone spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    await observe.span({ name: 'standalone', family: 'custom', primitive: 'custom.operation' }, async () => 'ok')
    await observe.flush()

    expect(transport.records.map((record) => record.type)).toEqual(['run:start', 'span:start', 'span:end', 'run:end'])
    expect(transport.records[0]).toMatchObject({ type: 'run:start', rootPrimitive: 'custom.operation' })
  })

    it('can run standalone detail spans without creating a visible run', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const result = await observe.span(
      { name: 'router.resolve', family: 'routing', primitive: 'routing.router', implicitRun: false },
      async () => 'resolved',
    )
    const openSpan = observe.openSpan({
      name: 'cascade.resolve',
      family: 'routing',
      primitive: 'routing.cascade',
      implicitRun: false,
    })
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

    const run = observe.openRun({ name: 'serverless swarm', rootPrimitive: 'composition.swarm' })
    const captured = run.captureContext()
    await run.withContext(async () => {
      await observe.span(
        { name: 'first turn', family: 'composition', primitive: 'composition.swarm' },
        async () => undefined,
      )
    })

    await observe.withContext(captured, async () => {
      await observe.span(
        { name: 'second turn', family: 'composition', primitive: 'composition.swarm' },
        async () => undefined,
      )
    })
    observe.endRun(captured)
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
    expect(firstStart).toMatchObject({ type: 'span:start', runId: runStart.runId, parentSpanId: null })
    expect(secondStart).toMatchObject({ type: 'span:start', runId: runStart.runId, parentSpanId: null })
    expect(runEnd).toMatchObject({ type: 'run:end', runId: runStart.runId, status: 'ok' })
  })

    it('emits events, artifacts, and edges inside the active span', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    await observe.run({ name: 'artifact run', rootPrimitive: 'custom.operation' }, async () => {
      await observe.span({ name: 'producer', family: 'custom', primitive: 'custom.operation' }, async () => {
        observe.event({ name: 'phase', attributes: { value: 'started' } })
        const artifactId = createCruxArtifactId('test_output')
        observe.artifact({
          artifactId,
          kind: 'output',
          contentType: 'application/json',
          encoding: 'json',
          preview: { ok: true },
        })
        observe.edge({
          edgeType: 'produced',
          from: { kind: 'span', id: observe.captureContext().currentSpanId! },
          to: { kind: 'artifact', id: artifactId },
        })
      })
    })
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
    expect(transport.records[2]).toMatchObject({ type: 'span:event', name: 'phase' })
    expect(transport.records[3]).toMatchObject({ type: 'artifact', kind: 'output' })
    expect(transport.records[4]).toMatchObject({ type: 'edge', edgeType: 'produced' })
  })

    it('records transport failures without throwing user code', async () => {
    setObservabilityTransport({
      async send() {
        throw new Error('collector offline')
      },
    })

    await expect(
      observe.run({ name: 'non throwing', rootPrimitive: 'custom.operation' }, async () => 'still works'),
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
      observe.run({ name: 'failing run', rootPrimitive: 'custom.operation' }, async () => {
        await observe.span({ name: 'failing span', family: 'custom', primitive: 'custom.operation' }, async () => {
          throw error
        })
      }),
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

    const run = observe.openRun({ name: 'manual run', rootPrimitive: 'custom.operation' })
    run.withContext(() => {
      const span = observe.openSpan({ name: 'manual span', family: 'custom', primitive: 'custom.operation' })
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
      error: { message: 'manual failure', name: 'Error', category: 'manual_error' },
      attributes: { phase: 'manual.finish', errorKind: 'manual_error' },
    })
  })

    it('flushes pending background deliveries for serverless shutdown paths', async () => {
    const delivered: string[] = []
    setObservabilityTransport({
      async send(records) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        delivered.push(...records.map((record) => record.type))
      },
    })

    await observe.run({ name: 'serverless', rootPrimitive: 'custom.operation' }, async () => 'ok')

    expect(delivered).toEqual([])
    await expect(observe.flush()).resolves.toBe(true)
    expect(delivered).toEqual(['run:start', 'run:end'])
  })

    it('starts the first delivery immediately for live devtools updates', () => {
    const send = vi.fn()
    setObservabilityTransport({ send })

    observe.openRun({ name: 'live run', rootPrimitive: 'custom.operation' })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toEqual([expect.objectContaining({ type: 'run:start', name: 'live run' })])
  })

    it('dispatches queued live deliveries while an earlier send is still in flight', async () => {
    let resolveFirstSend!: () => void
    const sentBatches: string[][] = []
    setObservabilityTransport({
      async send(records) {
        sentBatches.push(records.map((record) => record.type))
        if (sentBatches.length === 1) {
          await new Promise<void>((resolve) => {
            resolveFirstSend = resolve
          })
        }
      },
    })

    const run = observe.openRun({ name: 'live stream', rootPrimitive: 'custom.operation' })
    run.withContext(() => {
      const span = observe.openSpan({ name: 'child', family: 'custom', primitive: 'custom.operation' })
      span.end()
    })
    await new Promise((resolve) => queueMicrotask(resolve))

    expect(sentBatches.flat()).toEqual(['run:start', 'span:start', 'span:end'])
    resolveFirstSend()
    await observe.flush()
    expect(sentBatches.flat()).toEqual(['run:start', 'span:start', 'span:end'])
  })

    it('flushes queued deliveries when queueMicrotask is unavailable', async () => {
    const queueMicrotaskDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'queueMicrotask')
    Object.defineProperty(globalThis, 'queueMicrotask', { value: undefined, configurable: true })

    let resolveFirstSend!: () => void
    const sentBatches: string[][] = []
    setObservabilityTransport({
      async send(records) {
        sentBatches.push(records.map((record) => record.type))
        if (sentBatches.length === 1) {
          await new Promise<void>((resolve) => {
            resolveFirstSend = resolve
          })
        }
      },
    })

    try {
      const run = observe.openRun({ name: 'convex cleanup', rootPrimitive: 'runtime.convex.action' })
      run.withContext(() => {
        const span = observe.openSpan({ name: 'cleanup', family: 'runtime', primitive: 'runtime.convex.action' })
        span.end()
      })
      resolveFirstSend()
      await expect(observe.flush()).resolves.toBe(true)
      expect(sentBatches.flat()).toEqual(['run:start', 'span:start', 'span:end'])
    } finally {
      if (queueMicrotaskDescriptor) {
        Object.defineProperty(globalThis, 'queueMicrotask', queueMicrotaskDescriptor)
      } else {
        Reflect.deleteProperty(globalThis, 'queueMicrotask')
      }
    }
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
        },
      },
      { maxPendingDeliveries: 3 },
    )

    await observe.run({ name: 'fanout', rootPrimitive: 'custom.operation' }, async () => {
      await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          observe.span({ name: `branch ${index}`, family: 'custom', primitive: 'custom.operation' }, async () => index),
        ),
      )
    })
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

    await observe.run({ name: 'hung collector', rootPrimitive: 'custom.operation' }, async () => 'ok')

    await expect(observe.flush({ timeoutMs: 1 })).resolves.toBe(false)
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
        },
      },
      { maxPendingDeliveries: 1 },
    )

    await observe.run({ name: 'retry queued batch', rootPrimitive: 'custom.operation' }, async () => 'ok')

    await expect(observe.flush()).resolves.toBe(true)
    expect(delivered).toEqual(['run:start', 'run:end'])
    expect(observabilityDiagnostics().deliveryErrors).toHaveLength(1)
  })

    it('cancels bounded flush timers when delivery completes before the deadline', async () => {
    vi.useFakeTimers()
    try {
      let resolveSend!: () => void
      setObservabilityTransport({
        async send() {
          await new Promise<void>((resolve) => {
            resolveSend = resolve
          })
        },
      })

      observe.openRun({ name: 'bounded flush', rootPrimitive: 'custom.operation' })
      const flushed = observe.flush({ timeoutMs: 60_000 })
      await Promise.resolve()
      resolveSend()

      await expect(flushed).resolves.toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

    it('drops records instead of growing an unbounded delivery queue', async () => {
    setObservabilityTransport(
      {
        async send() {
          await new Promise(() => undefined)
        },
      },
      { maxPendingDeliveries: 1 },
    )

    await observe.run({ name: 'pressure', rootPrimitive: 'custom.operation' }, async () => {
      observe.event({ name: 'ignored-outside-span' })
    })

    expect(observabilityDiagnostics()).toMatchObject({
      pendingDeliveries: 1,
      droppedRecords: 0,
    })
  })

    it('posts canonical batches through the HTTP transport', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 202 }))
    const transport = createHttpObservabilityTransport({
      serverUrl: 'ws://localhost:4400/',
      fetch: fetchImpl,
      headers: { Authorization: 'Bearer test' },
      timeoutMs: 100,
    })
    setObservabilityTransport(transport)

    await observe.run({ name: 'http run', rootPrimitive: 'custom.operation' }, async () => 'ok')
    await observe.flush()

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:4400/api/observability/records')
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true',
        Authorization: 'Bearer test',
      },
    })
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
      records: [{ type: 'run:start', name: 'http run' }],
    })
  })

    it('preserves tokenized tunnel query params on HTTP transport endpoints', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 202 }))
    const transport = createHttpObservabilityTransport({
      serverUrl: 'https://example.ngrok.app?t=session-token',
      fetch: fetchImpl,
      timeoutMs: 100,
    })
    setObservabilityTransport(transport)

    await observe.run({ name: 'tunnel run', rootPrimitive: 'custom.operation' }, async () => 'ok')
    await observe.flush()

    expect(fetchImpl).toHaveBeenCalled()
    expect(fetchImpl.mock.calls[0][0]).toBe('https://example.ngrok.app/api/observability/records?t=session-token')
  })

    it('sends bearer auth from an HTTP transport token option', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 202 }))
    const transport = createHttpObservabilityTransport({
      serverUrl: 'https://example.ngrok.app',
      token: 'project-ingest-token',
      fetch: fetchImpl,
      timeoutMs: 100,
    })
    setObservabilityTransport(transport)

    await observe.run({ name: 'bearer run', rootPrimitive: 'custom.operation' }, async () => 'ok')
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
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 202 }))
      const transport = createHttpObservabilityTransport({
        serverUrl: 'https://example.ngrok.app',
        fetch: fetchImpl,
        timeoutMs: 100,
      })
      setObservabilityTransport(transport)

      await observe.run({ name: 'env bearer run', rootPrimitive: 'custom.operation' }, async () => 'ok')
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
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 202 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 202 }))
    const transport = createHttpObservabilityTransport({
      serverUrl: 'http://localhost:4400',
      fetch: fetchImpl,
      retryAttempts: 1,
      retryDelayMs: 1,
    })
    setObservabilityTransport(transport)

    await observe.run({ name: 'retry run', rootPrimitive: 'custom.operation' }, async () => 'ok')
    await expect(observe.flush()).resolves.toBe(true)

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(observabilityDeliveryErrors()).toHaveLength(0)
    const deliveredRecordTypes = fetchImpl.mock.calls
      .slice(1)
      .flatMap((call) => JSON.parse(String(call[1]?.body)).records.map((record: { type: string }) => record.type))
    expect(deliveredRecordTypes).toContain('run:start')
    expect(deliveredRecordTypes).toContain('run:end')
  })

    it('keeps terminal lifecycle records deliverable when late previews contain JSON-hostile values', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 202 }))
    const transport = createHttpObservabilityTransport({
      serverUrl: 'http://localhost:4400',
      fetch: fetchImpl,
      retryAttempts: 0,
    })
    setObservabilityTransport(transport)

    await observe.run({ name: 'json hostile preview', rootPrimitive: 'custom.operation' }, async () => {
      await observe.span({ name: 'producer', family: 'custom', primitive: 'custom.operation' }, async () => {
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
      })
    })
    await expect(observe.flush()).resolves.toBe(true)

    const deliveredRecords = fetchImpl.mock.calls.flatMap((call) => JSON.parse(String(call[1]?.body)).records)
    expect(deliveredRecords.map((record: { type: string }) => record.type)).toContain('span:end')
    expect(deliveredRecords.map((record: { type: string }) => record.type)).toContain('run:end')
    const artifact = deliveredRecords.find((record: { type: string }) => record.type === 'artifact')
    expect(artifact.preview).toMatchObject({
      count: '1',
      cyclic: { id: 'cyclic', self: '[Circular]' },
    })
    expect(observabilityDeliveryErrors()).toHaveLength(0)
  })

    it('isolates rejected HTTP records so one bad detail cannot strand terminal records', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const records = JSON.parse(String(init?.body)).records as Array<{ type: string; name?: string }>
      if (records.length > 1 && records.some((record) => record.type === 'artifact')) {
        return new Response('bad artifact', { status: 400 })
      }
      if (records.length === 1 && records[0].type === 'artifact') {
        return new Response('bad artifact', { status: 400 })
      }
      return new Response('{}', { status: 202 })
    })
    const transport = createHttpObservabilityTransport({
      serverUrl: 'http://localhost:4400',
      fetch: fetchImpl,
      retryAttempts: 0,
      maxRecordsPerRequest: 100,
    })
    setObservabilityTransport(transport)

    await observe.run({ name: 'partially bad batch', rootPrimitive: 'custom.operation' }, async () => {
      await observe.span({ name: 'producer', family: 'custom', primitive: 'custom.operation' }, async () => {
        observe.artifact({
          kind: 'output',
          contentType: 'application/json',
          encoding: 'json',
          preview: { validClientSide: true },
        })
      })
    })
    await expect(observe.flush()).resolves.toBe(true)

    const deliveredRecords = fetchImpl.mock.calls
      .map((call) => JSON.parse(String(call[1]?.body)).records as Array<{ type: string }>)
      .filter((records) => records.length === 1 || records.every((record) => record.type !== 'artifact'))
      .flat()
    expect(deliveredRecords.map((record) => record.type)).toContain('span:end')
    expect(deliveredRecords.map((record) => record.type)).toContain('run:end')
    expect(observabilityDeliveryErrors()).toHaveLength(0)
  })

    it('chunks large HTTP deliveries without treating the record list as a preview array', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 202 }))
    const transport = createHttpObservabilityTransport({
      serverUrl: 'http://localhost:4400',
      fetch: fetchImpl,
      retryAttempts: 0,
      maxRecordsPerRequest: 50,
    })
    const endedAt = new Date().toISOString()

    await transport.send(
      Array.from({ length: 205 }, (_, index) => ({
        schemaVersion: 1,
        recordId: `rec_chunk_${index}`,
        type: 'run:end',
        runId: `run_chunk_${index}`,
        traceId: `trace_chunk_${index}`,
        endedAt,
        status: 'ok',
      })),
    )

    const deliveredCount = fetchImpl.mock.calls.reduce((count, call) => {
      return count + JSON.parse(String(call[1]?.body)).records.length
    }, 0)
    expect(fetchImpl).toHaveBeenCalledTimes(5)
    expect(deliveredCount).toBe(205)
  })

    it('shutdown flushes bounded deliveries and disables later sends', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    await observe.run({ name: 'before shutdown', rootPrimitive: 'custom.operation' }, async () => 'ok')
    await expect(observe.shutdown()).resolves.toBe(true)
    await observe.run({ name: 'after shutdown', rootPrimitive: 'custom.operation' }, async () => 'ok')
    await observe.flush()

    expect(transport.records.map((record) => record.type)).toEqual(['run:start', 'run:end'])
  })
})
