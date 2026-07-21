import { afterEach, describe, expect, it } from 'vitest'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  sanitizePropagationCarrier,
  setObservabilityTransport,
  type CapturedObservabilityContext,
  type CruxGraphRecord,
} from '../../src/observability'

describe('observability operation families', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('keeps memory capture inside its owning operation family', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const root = observe.openRun({
      name: 'generation owner',
      rootPrimitive: 'generation.call',
    })
    let capture!: ReturnType<typeof observe.openSpan>

    root.withContext(() => {
      capture = observe.openSpan({
        name: 'memory.capture',
        primitive: 'memory.capture',
        implicitRun: false,
        attributes: {
          memoryId: 'conversation',
          operation: 'turn',
          requestedMode: 'inline',
          disposition: 'inline',
          sequence: 1,
          blockCount: 1,
          toolEventCount: 0,
        },
      })
      capture.end({ attributes: { outcome: 'completed' } })
    })
    root.end()
    await observe.flush()

    expect(capture.operationId).toBe(root.operationId)
    expect(capture.runId).toBe(root.runId)
    expect(transport.records).not.toContainEqual(
      expect.objectContaining({
        type: 'run:start',
        rootPrimitive: 'memory.capture',
      }),
    )
  })

  it('opens roots and explicit children with immutable family topology', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const root = observe.openRun({
      name: 'request',
      rootPrimitive: 'agent.run',
    })
    let child!: ReturnType<typeof observe.openChildRun>
    let triggerSpanId!: string

    root.withContext(() => {
      const trigger = observe.openSpan({
        name: 'research',
        primitive: 'tool.call',
      })
      triggerSpanId = trigger.spanId
      trigger.withContext(() => {
        child = observe.openChildRun(observe.captureContext()!, {
          name: 'research flow',
          rootPrimitive: 'flow.run',
        })
      })
      trigger.end()
    })
    child.end()
    root.end()
    await observe.flush()

    expect(root.operationId).toBe(root.runId)
    expect(child.operationId).toBe(root.operationId)
    expect(child.runId).not.toBe(root.runId)
    expect(child.parentRunId).toBe(root.runId)
    expect(child.triggeredBySpanId).toBe(triggerSpanId)
    expect(child.traceId).toBe(root.traceId)
    expect(
      transport.records.every(
        (record) => record.operationId === root.operationId,
      ),
    ).toBe(true)
    expect(
      transport.records.find(
        (record) => record.type === 'run:start' && record.runId === child.runId,
      ),
    ).toMatchObject({
      operationId: root.runId,
      parentRunId: root.runId,
      triggeredBySpanId: triggerSpanId,
    })
  })

  it('keeps roots in one trace as separate operations', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const first = observe.openRun({
      name: 'eval case one',
      rootPrimitive: 'eval.case',
    })
    const second = observe.openRun({
      traceId: first.traceId,
      name: 'eval case two',
      rootPrimitive: 'eval.case',
    })
    first.end()
    second.end()
    await observe.flush()

    expect(first.traceId).toBe(second.traceId)
    expect(first.operationId).toBe(first.runId)
    expect(second.operationId).toBe(second.runId)
    expect(second.operationId).not.toBe(first.operationId)
  })

  it('resumes a child without changing its operation or parent', async () => {
    const root = observe.openRun({
      name: 'request',
      rootPrimitive: 'agent.run',
    })
    const child = observe.openChildRun(root.captureContext(), {
      name: 'durable flow',
      rootPrimitive: 'flow.run',
    })
    const carrier = child.suspend({ reason: 'signal' })
    const resumed = observe.resumeRun(carrier, { reason: 'wake' })

    expect(resumed.operationId).toBe(root.runId)
    expect(resumed.runId).toBe(child.runId)
    expect(resumed.parentRunId).toBe(root.runId)
    expect(resumed.segmentId).not.toBe(child.segmentId)
    resumed.end()
    root.end()
  })

  it('continues a host invocation in a fresh segment without lifecycle records', async () => {
    const records: CruxGraphRecord[] = []
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const root = observe.openRun({
      name: 'request',
      rootPrimitive: 'agent.run',
    })
    let captured!: CapturedObservabilityContext
    let parentSpanId!: string
    root.withContext(() => {
      const parent = observe.openSpan({
        name: 'host call',
        primitive: 'runtime.convex.action',
      })
      parentSpanId = parent.spanId
      parent.withContext(() => {
        captured = observe.captureContext()!
      })
      parent.end()
    })

    observe.continueInNewSegment(captured, () => {
      observe
        .openSpan({
          name: 'receiver',
          primitive: 'runtime.convex.action',
        })
        .end()
    })
    root.end()
    await observe.flush()
    records.push(...transport.records)

    const receiver = records.find(
      (record) => record.type === 'span:start' && record.name === 'receiver',
    )
    expect(receiver).toMatchObject({
      operationId: root.operationId,
      runId: root.runId,
      parentSpanId,
      segmentSeq: 1,
    })
    expect(receiver?.segmentId).not.toBe(root.segmentId)
    expect(records.some((record) => record.type === 'run:resume')).toBe(false)
    expect(records.some((record) => record.type === 'run:suspend')).toBe(false)
  })

  it('rejects malformed child contexts and inconsistent explicit carriers', () => {
    const root = observe.openRun({
      name: 'request',
      rootPrimitive: 'agent.run',
    })
    const { operationId: _operationId, ...missingOperation } =
      root.captureContext()
    expect(() =>
      observe.openChildRun(missingOperation as CapturedObservabilityContext, {
        name: 'invalid',
        rootPrimitive: 'flow.run',
      }),
    ).toThrow(/operationId/)

    expect(() =>
      sanitizePropagationCarrier({
        traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
        crux: {
          operationId: 'run_111111111111111111111111',
          runId: 'run_222222222222222222222222',
        },
      }),
    ).toThrow(/parentRunId/)
  })

  it('backfills legacy carrier operation identity from its run id', () => {
    const carrier = sanitizePropagationCarrier({
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
      crux: { runId: 'run_0123456789abcdef01234567' },
    })
    expect(carrier.crux.operationId).toBe(carrier.crux.runId)
  })
})
