import { describe, expect, it } from 'vitest'
import {
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  createCruxRecordId,
  createCruxRunId,
  createCruxSpanId,
  createCruxSpanEventId,
  createCruxTraceId,
  type CruxGraphRecord,
} from '@use-crux/core/observability'
import { createCallbackExporter } from '../src/exporter'
import { createOtelRecordSubscriber } from '../src/record-mapper'
import { createLightweightSpanManager } from '../src/span-manager'
import type { TraceSpan } from '../src/types'

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
    seq: 1,
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
    seq: 1,
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
    seq: 1,
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
    seq: 1,
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
    seq: 1,
    traceId: options.traceId,
    spanId: options.spanId,
    eventId: createCruxSpanEventId(),
    name: options.name,
    timestamp: options.now,
    attributes: options.attributes,
  }
}
