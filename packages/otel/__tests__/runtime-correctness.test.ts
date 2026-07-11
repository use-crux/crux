import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  createCruxRecordId,
  createCruxRunId,
  createCruxSpanId,
  createCruxSpanEventId,
  createCruxSegmentId,
  createCruxTraceId,
  observe,
  resetObservabilityRuntime,
  sanitizePropagationCarrier,
  type CruxGraphRecord,
} from '@use-crux/core/observability'
import { config, orchestrateStream, resetHooks, type OrchestrationSpec } from '@use-crux/core'
import { context, trace } from '@opentelemetry/api'
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { createCallbackExporter } from '../src/exporter'
import { createOtelRecordSubscriber } from '../src/record-mapper'
import { createLightweightSpanManager } from '../src/span-manager'
import { withTelemetry } from '../src/plugin'
import { __resetOpenTelemetryFallbackForTesting } from '../src/otel-span-manager'
import { extractCruxPropagationCarrier, injectCruxPropagationCarrier } from '../src/propagation'
import type { TraceSpan } from '../src/types'

function headerMap(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    get: (name: string) => store.get(name) ?? null,
    set: (name: string, value: string) => {
      store.set(name, value)
    },
  }
}

describe('OTel runtime correctness', () => {
  it('parents a late child span to the run span when the recorded parent has already ended', () => {
    const spans: TraceSpan[] = []
    const subscriber = createOtelRecordSubscriber(
      createLightweightSpanManager(
        createCallbackExporter((batch) => {
          spans.push(...batch)
        }),
      ),
    )
    const runId = createCruxRunId()
    const traceId = createCruxTraceId()
    const parentSpanId = createCruxSpanId()
    const childSpanId = createCruxSpanId()
    const now = new Date('2026-07-03T00:00:00.000Z').toISOString()

    const records = [
      runStart({
        runId,
        traceId,
        name: 'late child run',
        rootPrimitive: 'generation.call',
        now,
      }),
      spanStart({
        runId,
        traceId,
        spanId: parentSpanId,
        parentSpanId: null,
        family: 'generation',
        primitive: 'generation.call',
        name: 'parent generation',
        now,
      }),
      spanEnd({
        runId,
        traceId,
        spanId: parentSpanId,
        now,
        recordId: 'late-child-parent-end',
      }),
      spanStart({
        runId,
        traceId,
        spanId: childSpanId,
        parentSpanId,
        family: 'tool',
        primitive: 'tool.call',
        name: 'late child',
        now,
        attributes: { toolName: 'lateTool' },
      }),
      spanEnd({
        runId,
        traceId,
        spanId: childSpanId,
        now,
        recordId: 'late-child-child-end',
      }),
      runEnd({ runId, traceId, now, recordId: 'late-child-run-end' }),
    ] satisfies CruxGraphRecord[]

    records.forEach(subscriber)

    const run = spans.find((span) => span.name === 'late child run')
    const child = spans.find((span) => span.name === 'execute_tool lateTool')

    expect(run).toBeDefined()
    expect(child).toBeDefined()
    expect(child?.parentSpanId).toBe(run?.spanId)
    expect(child?.traceId).toBe(run?.traceId)
  })

  it('attaches late span events for ended spans to the still-open run span', () => {
    const spans: TraceSpan[] = []
    const subscriber = createOtelRecordSubscriber(
      createLightweightSpanManager(
        createCallbackExporter((batch) => {
          spans.push(...batch)
        }),
      ),
    )
    const runId = createCruxRunId()
    const traceId = createCruxTraceId()
    const spanId = createCruxSpanId()
    const now = new Date('2026-07-03T00:00:00.000Z').toISOString()

    ;[
      runStart({
        runId,
        traceId,
        name: 'late event run',
        rootPrimitive: 'generation.call',
        now,
      }),
      spanStart({
        runId,
        traceId,
        spanId,
        parentSpanId: null,
        family: 'generation',
        primitive: 'generation.call',
        name: 'ended generation',
        now,
      }),
      spanEnd({ runId, traceId, spanId, now, recordId: 'late-event-span-end' }),
      spanEvent({
        runId,
        traceId,
        spanId,
        now,
        name: 'provider.chunk',
        attributes: { chunkIndex: 1 },
      }),
      runEnd({ runId, traceId, now, recordId: 'late-event-run-end' }),
    ].forEach(subscriber)

    const run = spans.find((span) => span.name === 'late event run')
    expect(run?.events).toContainEqual(
      expect.objectContaining({
        name: 'provider.chunk',
        attributes: expect.objectContaining({
          'crux.chunkIndex': 1,
          'crux.late_for_span': spanId,
        }),
      }),
    )
  })

  it('drops late span events after the owning run has ended', () => {
    const spans: TraceSpan[] = []
    const subscriber = createOtelRecordSubscriber(
      createLightweightSpanManager(
        createCallbackExporter((batch) => {
          spans.push(...batch)
        }),
      ),
    )
    const runId = createCruxRunId()
    const traceId = createCruxTraceId()
    const spanId = createCruxSpanId()
    const now = new Date('2026-07-03T00:00:00.000Z').toISOString()

    ;[
      runStart({
        runId,
        traceId,
        name: 'late dropped run',
        rootPrimitive: 'generation.call',
        now,
      }),
      spanStart({
        runId,
        traceId,
        spanId,
        parentSpanId: null,
        family: 'generation',
        primitive: 'generation.call',
        name: 'ended generation',
        now,
      }),
      spanEnd({
        runId,
        traceId,
        spanId,
        now,
        recordId: 'late-dropped-span-end',
      }),
      runEnd({ runId, traceId, now, recordId: 'late-dropped-run-end' }),
      spanEvent({
        runId,
        traceId,
        spanId,
        now,
        name: 'provider.chunk',
        attributes: { chunkIndex: 1 },
      }),
    ].forEach(subscriber)

    expect(JSON.stringify(spans)).not.toContain('provider.chunk')
    expect(JSON.stringify(spans)).not.toContain('crux.late_for_span')
  })

  it('expires the least-recently used open spans when the OTel registry cap is reached', () => {
    const spans: TraceSpan[] = []
    const subscriber = createOtelRecordSubscriber(
      createLightweightSpanManager(
        createCallbackExporter((batch) => {
          spans.push(...batch)
        }),
      ),
    )
    const runId = createCruxRunId()
    const traceId = createCruxTraceId()
    const now = new Date('2026-07-03T00:00:00.000Z').toISOString()

    subscriber(
      runStart({
        runId,
        traceId,
        name: 'registry cap run',
        rootPrimitive: 'tool.call',
        now,
      }),
    )

    for (let index = 0; index < 10_000; index++) {
      subscriber(
        spanStart({
          runId,
          traceId,
          spanId: createCruxSpanId(),
          parentSpanId: null,
          family: 'tool',
          primitive: 'tool.call',
          name: `registry cap span ${index}`,
          now,
          recordId: `registry-cap-span-start-${index}`,
          attributes: { toolName: `tool-${index}` },
        }),
      )
    }

    expect(spans).toEqual([
      expect.objectContaining({
        name: 'execute_tool tool-0',
        status: { code: 'UNSET' },
        attributes: expect.objectContaining({ 'crux.expired': true }),
      }),
    ])
  })
})

describe('Active OTel execution bridge', () => {
  let provider: BasicTracerProvider
  let exporter: InMemorySpanExporter
  let contextManager: AsyncHooksContextManager

  beforeEach(() => {
    resetHooks()
    resetObservabilityRuntime()
    __resetOpenTelemetryFallbackForTesting()
    trace.disable()
    context.disable()
    exporter = new InMemorySpanExporter()
    provider = new BasicTracerProvider()
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    trace.setGlobalTracerProvider(provider)
    contextManager = new AsyncHooksContextManager()
    contextManager.enable()
    context.setGlobalContextManager(contextManager)
  })

  afterEach(async () => {
    trace.disable()
    context.disable()
    contextManager.disable()
    await provider.shutdown()
  })

  it('makes the Crux-created span the active OTel span inside the real callback', async () => {
    const crux = config({ plugins: [withTelemetry({ serviceName: 'active-bridge' })] })
    let activeSpanIdInsideCallback: string | undefined

    await observe.span({ name: 'generate', primitive: 'generation.call' }, async () => {
      activeSpanIdInsideCallback = trace.getActiveSpan()?.spanContext().spanId
    })
    await crux.dispose()

    const finished = exporter.getFinishedSpans()
    const spanRecord = finished.find((span) => span.name === 'chat generate')
    expect(spanRecord).toBeDefined()
    expect(activeSpanIdInsideCallback).toBeDefined()
    expect(activeSpanIdInsideCallback).toBe(spanRecord?.spanContext().spanId)
  })

  it('parents a real OTel span started inside the callback under the active Crux span', async () => {
    const crux = config({ plugins: [withTelemetry({ serviceName: 'active-bridge' })] })

    await observe.span({ name: 'generate', primitive: 'generation.call' }, async () => {
      const tracer = trace.getTracer('provider-sdk')
      const nested = tracer.startSpan('provider internal call')
      nested.end()
    })
    await crux.dispose()

    const finished = exporter.getFinishedSpans()
    const outer = finished.find((span) => span.name === 'chat generate')
    const nested = finished.find((span) => span.name === 'provider internal call')

    expect(outer).toBeDefined()
    expect(nested).toBeDefined()
    expect(nested?.parentSpanId).toBe(outer?.spanContext().spanId)
    expect(nested?.spanContext().traceId).toBe(outer?.spanContext().traceId)
  })

  it('activates the run root span inside run-level work with no open span yet', async () => {
    const crux = config({ plugins: [withTelemetry({ serviceName: 'active-bridge' })] })
    let activeDuringRun: string | undefined

    const run = observe.openRun({ name: 'flow', rootPrimitive: 'flow.run' })
    await run.withContext(async () => {
      activeDuringRun = trace.getActiveSpan()?.spanContext().spanId
    })
    run.end()
    await crux.dispose()

    const finished = exporter.getFinishedSpans()
    const runSpan = finished.find((span) => span.name === 'flow')
    expect(activeDuringRun).toBeDefined()
    expect(activeDuringRun).toBe(runSpan?.spanContext().spanId)
  })

  it('does not leak active span context across concurrent sibling calls', async () => {
    const crux = config({ plugins: [withTelemetry({ serviceName: 'active-bridge' })] })
    const seen: Record<string, string | undefined> = {}

    await Promise.all([
      observe.span({ name: 'a', primitive: 'tool.call' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        seen.a = trace.getActiveSpan()?.spanContext().spanId
      }),
      observe.span({ name: 'b', primitive: 'tool.call' }, async () => {
        seen.b = trace.getActiveSpan()?.spanContext().spanId
      }),
    ])
    await crux.dispose()

    const finished = exporter.getFinishedSpans()
    const aSpan = finished.find((span) => span.name === 'execute_tool a')
    const bSpan = finished.find((span) => span.name === 'execute_tool b')

    expect(seen.a).toBe(aSpan?.spanContext().spanId)
    expect(seen.b).toBe(bSpan?.spanContext().spanId)
    expect(seen.a).not.toBe(seen.b)
  })

  it('ends the segment root span on suspend and starts a fresh root span sharing the trace on resume, without holding one span open across the boundary', async () => {
    const first = config({ plugins: [withTelemetry({ serviceName: 'active-bridge' })] })

    const run = observe.openRun({ name: 'suspendable flow', rootPrimitive: 'flow.run' })
    const carrier = run.suspend({ reason: 'waiting-for-signal' })
    await first.dispose()

    const suspendSpan = exporter.getFinishedSpans().at(0)
    expect(suspendSpan).toBeDefined()
    expect(suspendSpan?.attributes['crux.run.suspended']).toBe(true)

    const second = config({ plugins: [withTelemetry({ serviceName: 'active-bridge' })] })
    let activeDuringResume: string | undefined
    const resumed = observe.resumeRun(sanitizePropagationCarrier(carrier), { reason: 'signal-received' })
    await resumed.withContext(async () => {
      activeDuringResume = trace.getActiveSpan()?.spanContext().spanId
    })
    resumed.end()
    await second.dispose()

    const resumeSpan = exporter.getFinishedSpans().find((span) => span.attributes['crux.run.resumed'] === true)

    expect(resumeSpan).toBeDefined()
    expect(resumeSpan?.spanContext().traceId).toBe(suspendSpan?.spanContext().traceId)
    expect(resumeSpan?.spanContext().spanId).not.toBe(suspendSpan?.spanContext().spanId)
    expect(activeDuringResume).toBe(resumeSpan?.spanContext().spanId)
  })

  it('carries allowlisted baggage across a real inbound carrier boundary onto the resumed root span (Flow/Convex resume path)', async () => {
    const crux = config({
      plugins: [withTelemetry({ serviceName: 'active-bridge', baggageAttributeAllowlist: ['tenant'] })],
    })

    // A prior segment's continuation carrier, exactly as Flow's flowRun.captureContinuation()/.suspend() produce it.
    const priorRun = observe.openRun({ name: 'source flow', rootPrimitive: 'flow.run' })
    const carrier = priorRun.suspend({ reason: 'awaiting-boundary' })

    // Simulate the carrier actually crossing a wire boundary (e.g. an inbound HTTP/Convex call) with baggage attached.
    const wire = headerMap()
    injectCruxPropagationCarrier(carrier, wire)
    wire.set('baggage', 'tenant=acme,secret=do-not-leak')
    const { carrier: inbound, baggageAttributes } = extractCruxPropagationCarrier(wire, {
      baggageAttributeAllowlist: ['tenant'],
    })
    expect(inbound).toBeDefined()
    expect(baggageAttributes).toEqual({ 'crux.baggage.tenant': 'acme' })

    // A fresh process/segment resumes the same logical run from the inbound carrier — this is the exact
    // call flow/scope.ts and Convex's wrappers use: observe.resumeRun(sanitizePropagationCarrier(continuation), ...).
    const resumed = observe.resumeRun(inbound!, { reason: 'boundary-resume' })
    resumed.end()
    await crux.dispose()

    const resumeSpan = exporter.getFinishedSpans().find((span) => span.attributes['crux.run.resumed'] === true)
    expect(resumeSpan).toBeDefined()
    expect(resumeSpan?.attributes['crux.baggage.tenant']).toBe('acme')
    expect(Object.keys(resumeSpan?.attributes ?? {})).not.toContain('crux.baggage.secret')
    expect(JSON.stringify(resumeSpan?.attributes)).not.toContain('do-not-leak')
  })

  it('never applies baggage attributes when withTelemetry has no baggageAttributeAllowlist configured', async () => {
    const crux = config({ plugins: [withTelemetry({ serviceName: 'active-bridge' })] })

    const priorRun = observe.openRun({ name: 'source flow', rootPrimitive: 'flow.run' })
    const carrier = priorRun.suspend({ reason: 'awaiting-boundary' })

    const wire = headerMap()
    injectCruxPropagationCarrier(carrier, wire)
    wire.set('baggage', 'tenant=acme')
    const { carrier: inbound } = extractCruxPropagationCarrier(wire)

    const resumed = observe.resumeRun(inbound!, { reason: 'boundary-resume' })
    resumed.end()
    await crux.dispose()

    const resumeSpan = exporter.getFinishedSpans().find((span) => span.attributes['crux.run.resumed'] === true)
    expect(resumeSpan).toBeDefined()
    expect(Object.keys(resumeSpan?.attributes ?? {})).not.toContain('crux.baggage.tenant')
  })

  it('keeps the Crux operation span active during real provider chunk production, not only the initial stream call', async () => {
    const crux = config({ plugins: [withTelemetry({ serviceName: 'active-bridge' })] })
    const activeSpanIdsDuringChunkProduction: Array<string | undefined> = []

    async function* rawProviderStream(): AsyncIterable<{ text: string }> {
      for (const text of ['hel', 'lo']) {
        // Simulate real async provider work (e.g. a network read) between
        // pulls, so this only proves genuine cross-await context
        // propagation, not just synchronous call-stack coincidence.
        await new Promise((resolve) => setTimeout(resolve, 0))
        activeSpanIdsDuringChunkProduction.push(trace.getActiveSpan()?.spanContext().spanId)
        yield { text }
      }
    }

    const spec: OrchestrationSpec<Record<string, unknown>> = {
      promptId: 'support.reply',
      promptConfig: {} as OrchestrationSpec<Record<string, unknown>>['promptConfig'],
      preparedArgs: { model: 'gpt-4o', system: 'You help.', messages: [{ role: 'user', content: 'Hello' }] },
      model: 'gpt-4o',
      input: { message: 'Hello' },
      operation: 'stream',
      provider: 'openai',
      outputMode: 'text',
    }

    const handle = await orchestrateStream(spec, async () => ({
      rawStream: rawProviderStream(),
      extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
      completion: async () => ({
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, inputTokenDetails: {}, outputTokenDetails: {} },
      }),
    }))

    for await (const _chunk of handle.rawStream as AsyncIterable<unknown>) {
      // drain
    }
    await crux.dispose()

    const streamSpan = exporter.getFinishedSpans().find((span) => span.name.startsWith('chat '))
    expect(streamSpan).toBeDefined()
    expect(activeSpanIdsDuringChunkProduction).toHaveLength(2)
    for (const spanId of activeSpanIdsDuringChunkProduction) {
      expect(spanId).toBe(streamSpan?.spanContext().spanId)
    }
  })
})

function runStart(options: {
  readonly runId: ReturnType<typeof createCruxRunId>
  readonly traceId: ReturnType<typeof createCruxTraceId>
  readonly name: string
  readonly rootPrimitive: Extract<
    CruxGraphRecord,
    { type: 'run:start' }
  >['rootPrimitive']
  readonly now: string
}): Extract<CruxGraphRecord, { type: 'run:start' }> {
  return {
    type: 'run:start',
    schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
    recordId: createCruxRecordId(),
    runId: options.runId,
    segmentId: createCruxSegmentId(),
    segmentSeq: 1,
    traceId: options.traceId,
    name: options.name,
    rootPrimitive: options.rootPrimitive,
    startedAt: options.now,
    status: 'running',
  }
}

function runEnd(options: {
  readonly runId: ReturnType<typeof createCruxRunId>
  readonly traceId: ReturnType<typeof createCruxTraceId>
  readonly now: string
  readonly recordId: string
}): Extract<CruxGraphRecord, { type: 'run:end' }> {
  return {
    type: 'run:end',
    schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
    recordId: createCruxRecordId(),
    runId: options.runId,
    segmentId: createCruxSegmentId(),
    segmentSeq: 1,
    traceId: options.traceId,
    endedAt: options.now,
    status: 'ok',
  }
}

function spanStart(options: {
  readonly runId: ReturnType<typeof createCruxRunId>
  readonly traceId: ReturnType<typeof createCruxTraceId>
  readonly spanId: ReturnType<typeof createCruxSpanId>
  readonly parentSpanId: ReturnType<typeof createCruxSpanId> | null
  readonly family: Extract<CruxGraphRecord, { type: 'span:start' }>['family']
  readonly primitive: Extract<
    CruxGraphRecord,
    { type: 'span:start' }
  >['primitive']
  readonly name: string
  readonly now: string
  readonly recordId?: string
  readonly attributes?: Extract<
    CruxGraphRecord,
    { type: 'span:start' }
  >['attributes']
}): Extract<CruxGraphRecord, { type: 'span:start' }> {
  return {
    type: 'span:start',
    schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
    recordId: createCruxRecordId(),
    runId: options.runId,
    segmentId: createCruxSegmentId(),
    segmentSeq: 1,
    traceId: options.traceId,
    spanId: options.spanId,
    parentSpanId: options.parentSpanId,
    family: options.family,
    primitive: options.primitive,
    name: options.name,
    startedAt: options.now,
    status: 'running',
    attributes: options.attributes,
  }
}

function spanEnd(options: {
  readonly runId: ReturnType<typeof createCruxRunId>
  readonly traceId: ReturnType<typeof createCruxTraceId>
  readonly spanId: ReturnType<typeof createCruxSpanId>
  readonly now: string
  readonly recordId: string
}): Extract<CruxGraphRecord, { type: 'span:end' }> {
  return {
    type: 'span:end',
    schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
    recordId: createCruxRecordId(),
    runId: options.runId,
    segmentId: createCruxSegmentId(),
    segmentSeq: 1,
    traceId: options.traceId,
    spanId: options.spanId,
    endedAt: options.now,
    status: 'ok',
  }
}

function spanEvent(options: {
  readonly runId: ReturnType<typeof createCruxRunId>
  readonly traceId: ReturnType<typeof createCruxTraceId>
  readonly spanId: ReturnType<typeof createCruxSpanId>
  readonly now: string
  readonly name: string
  readonly attributes?: Extract<
    CruxGraphRecord,
    { type: 'span:event' }
  >['attributes']
}): Extract<CruxGraphRecord, { type: 'span:event' }> {
  return {
    type: 'span:event',
    schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
    recordId: createCruxRecordId(),
    runId: options.runId,
    segmentId: createCruxSegmentId(),
    segmentSeq: 1,
    traceId: options.traceId,
    spanId: options.spanId,
    eventId: createCruxSpanEventId(),
    name: options.name,
    timestamp: options.now,
    attributes: options.attributes,
  }
}
