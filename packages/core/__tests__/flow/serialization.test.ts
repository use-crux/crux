import { afterEach, describe, expect, it } from 'vitest'
import { cancelFlow, flow } from '../../flow'
import { resetHooks, updateHooks } from '../../runtime/runtime'
import { inMemoryRecordStore } from '../../storage'

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
})
