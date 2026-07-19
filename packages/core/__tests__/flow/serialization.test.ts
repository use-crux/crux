import { afterEach, describe, expect, it } from 'vitest'
import { cancelFlow, flow, getFlowSnapshot } from '../../src/flow'
import { resetHooks, updateHooks } from '../../src/runtime/runtime'
import { inMemoryRecordStore } from '../../src/storage'

describe('flow serialization guards', () => {
  afterEach(() => {
    resetHooks()
  })

  it('rejects non-serializable input before writing a suspended snapshot', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })

    const review = flow('reject non-json input', async (scope, input: { value: unknown }) => {
      await scope.suspend('approval')
      return input.value
    })

    await expect(
      review.run({ value: () => undefined }, { flowId: 'flow-non-json-input' }),
    ).rejects.toMatchObject({
      name: 'FlowSerializationError',
      boundary: 'flow input',
      message: expect.stringContaining('Flow input must be JSON-serializable'),
    })
    await expect(store.get('crux:flow:flow-non-json-input')).resolves.toBeNull()
  })

  it('rejects non-serializable step output before writing a suspended snapshot', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })

    const review = flow('reject non-json step output', async (scope) => {
      await scope.step('load', () => ({ value: () => undefined }))
      await scope.suspend('approval')
      return 'published'
    })

    await expect(review.run({ flowId: 'flow-non-json-step-output' })).rejects.toMatchObject({
      name: 'FlowSerializationError',
      boundary: 'step output',
      message: expect.stringContaining('Flow step output must be JSON-serializable'),
    })
    await expect(store.get('crux:flow:flow-non-json-step-output')).resolves.toBeNull()
  })

  it('rejects non-serializable signal payload before writing the pending signal', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })

    const review = flow('reject non-json signal payload', async (scope) => {
      await scope.suspend('approval')
      return 'published'
    })

    const suspended = await review.run({ flowId: 'flow-non-json-signal-payload' })
    expect(suspended.status).toBe('suspended')

    await expect(
      review.signal(suspended.flowId, 'approval', { value: () => undefined }),
    ).rejects.toMatchObject({
      name: 'FlowSerializationError',
      boundary: 'signal payload',
      message: expect.stringContaining('Flow signal payload must be JSON-serializable'),
    })
    await expect(store.get(`crux:signal:${suspended.flowId}:approval`)).resolves.toBeNull()
  })

  it('rejects non-serializable lifecycle metadata before writing a terminal snapshot', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })

    const review = flow('reject non-json lifecycle metadata', async (scope) => {
      scope.cancel({ value: () => undefined } as unknown as string)
    })

    await expect(review.run({ flowId: 'flow-non-json-lifecycle-metadata' })).rejects.toMatchObject({
      name: 'FlowSerializationError',
      boundary: 'flow snapshot metadata',
      message: expect.stringContaining('Flow snapshot metadata must be JSON-serializable'),
    })
    await expect(store.get('crux:flow:flow-non-json-lifecycle-metadata')).resolves.toBeNull()
  })

  it('rejects non-serializable external cancellation metadata before updating a snapshot', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })

    const review = flow('reject non-json external cancel metadata', async (scope) => {
      await scope.suspend('approval')
      return 'published'
    })

    const suspended = await review.run({ flowId: 'flow-non-json-external-cancel' })
    expect(suspended.status).toBe('suspended')

    await expect(
      cancelFlow(suspended.flowId, { value: () => undefined } as unknown as string),
    ).rejects.toMatchObject({
      name: 'FlowSerializationError',
      boundary: 'flow snapshot metadata',
      message: expect.stringContaining('Flow snapshot metadata must be JSON-serializable'),
    })
    await expect(store.get(`crux:flow:${suspended.flowId}`)).resolves.toMatchObject({
      status: 'suspended',
    })
  })

  it('does not persist invocation metadata returned as a step output', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })
    const child = flow('observed child output', async () => 'ready')
    const parent = flow('strip observed step output', async (scope) => {
      await scope.step('child', () => child.run())
      await scope.suspend('approval')
      return 'published'
    })

    const suspended = await parent.run({ flowId: 'flow-strip-result-meta-output' })
    const snapshot = await getFlowSnapshot(suspended.flowId)

    expect(snapshot?.completedSteps.child?.output).toMatchObject({
      status: 'completed',
      output: 'ready',
    })
    expect(snapshot?.completedSteps.child?.output).not.toHaveProperty('_meta')
  })

  it('recursively removes only reserved result ids from persisted step output', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })
    const liveOutput = {
      traceId: 'domain-trace',
      nested: [
        {
          _meta: {
            traceId: 'operation-trace',
            spanId: 'operation-span',
            responseId: 'provider-response',
            model: 'provider-model',
            raw: {
              _meta: { traceId: 'metadata-raw-trace', spanId: 'metadata-raw-span' },
            },
          },
          raw: {
            _meta: { traceId: 'raw-trace', spanId: 'raw-span' },
          },
        },
        { _meta: { traceId: 'empty-trace', spanId: 'empty-span' } },
      ],
    }
    const review = flow('sanitize nested step output', async (scope) => {
      await scope.step('load', () => liveOutput)
      await scope.suspend('approval')
      return 'published'
    })

    const suspended = await review.run({ flowId: 'flow-sanitize-nested-step-output' })
    const snapshot = await getFlowSnapshot(suspended.flowId)
    const persisted = snapshot?.completedSteps.load?.output

    expect(persisted).toEqual({
      traceId: 'domain-trace',
      nested: [
        {
          _meta: {
            responseId: 'provider-response',
            model: 'provider-model',
            raw: {
              _meta: { traceId: 'metadata-raw-trace', spanId: 'metadata-raw-span' },
            },
          },
          raw: {
            _meta: { traceId: 'raw-trace', spanId: 'raw-span' },
          },
        },
        {},
      ],
    })
    expect(liveOutput.nested[0]?._meta).toMatchObject({
      traceId: 'operation-trace',
      spanId: 'operation-span',
    })
  })

  it('sanitizes a pending signal payload without mutating the live value', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })
    const review = flow('sanitize pending signal', async (scope) => {
      await scope.suspend('approval')
      return 'published'
    })
    const suspended = await review.run({ flowId: 'flow-sanitize-pending-signal' })
    const livePayload = {
      nested: [{ _meta: { traceId: 'old-trace', spanId: 'old-span', responseId: 'kept' } }],
    }

    await review.signal(suspended.flowId, 'approval', livePayload, { resume: false })

    const storedSignal = await store.get(
      `crux:signal:${suspended.flowId}:approval`,
    )
    expect(storedSignal?.payload).toEqual({
      nested: [{ _meta: { responseId: 'kept' } }],
    })
    expect(livePayload.nested[0]?._meta).toMatchObject({
      traceId: 'old-trace',
      spanId: 'old-span',
    })
  })

  it('sanitizes snapshot input while preserving continuation trace context', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })
    const liveInput = {
      _meta: {
        traceId: 'input-trace',
        spanId: 'input-span',
        responseId: 'input-response',
      },
    }
    const review = flow(
      'sanitize record snapshot input',
      async (scope, _input: typeof liveInput) => {
        await scope.suspend('approval')
        return 'published'
      },
    )

    const suspended = await review.run(liveInput, {
      flowId: 'flow-sanitize-record-input',
    })
    const snapshot = await getFlowSnapshot(suspended.flowId)

    expect(snapshot?.input).toEqual({
      _meta: { responseId: 'input-response' },
    })
    expect(snapshot?.continuation).toMatchObject({
      traceparent: expect.any(String),
    })
    expect(liveInput._meta).toMatchObject({
      traceId: 'input-trace',
      spanId: 'input-span',
    })
  })

  it('removes legacy top-level result metadata when rewriting a snapshot', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })
    const review = flow('strip legacy snapshot metadata', async (scope) => {
      await scope.suspend('approval')
      return 'published'
    })
    const suspended = await review.run({ flowId: 'flow-strip-legacy-result-meta' })
    const snapshot = await getFlowSnapshot(suspended.flowId)
    expect(snapshot).not.toBeNull()
    await store.put(`crux:flow:${suspended.flowId}`, {
      ...snapshot,
      _meta: { traceId: 'legacy-trace', spanId: 'legacy-span' },
    })

    await review.signal(suspended.flowId, 'approval', undefined, { resume: false })
    await review.resume(suspended.flowId)

    await expect(getFlowSnapshot(suspended.flowId)).resolves.not.toHaveProperty('_meta')
  })
})
