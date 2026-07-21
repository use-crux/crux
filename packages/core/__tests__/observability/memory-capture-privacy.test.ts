import { afterEach, describe, expect, it } from 'vitest'
import { memory, memoryBlock } from '../../src/memory'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'

describe('memory capture observation privacy', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('records only a sanitized code when capture fails', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const rawError = Object.assign(new Error('RAW_ERROR_SECRET'), {
      code: 'STORAGE_UNAVAILABLE',
    })
    const mem = memory({
      id: 'private-memory',
      namespace: 'NAMESPACE_SECRET',
      capture: { mode: 'inline' },
      blocks: [
        memoryBlock({
          id: 'capture',
          captureTurn: async () => {
            throw rawError
          },
        }),
      ],
    })
    let caught: unknown

    await observe.run(
      { name: 'capture owner', rootPrimitive: 'custom.operation' },
      async () => {
        try {
          await mem.captureTurn({
            messages: [{ role: 'user', content: 'MESSAGE_SECRET' }],
            toolEvents: [
              {
                toolName: 'TOOL_NAME_SECRET',
                args: { value: 'TOOL_ARGS_SECRET' },
                result: { value: 'TOOL_RESULT_SECRET' },
              },
            ],
          })
        } catch (error) {
          caught = error
        }
      },
    )
    await observe.flush()

    expect(caught).toBe(rawError)
    const captureStart = transport.records.find(
      (record) =>
        record.type === 'span:start' && record.primitive === 'memory.capture',
    )
    const captureEnd = transport.records.find(
      (record) =>
        record.type === 'span:end' && record.spanId === captureStart?.spanId,
    )
    expect(captureEnd).toMatchObject({
      status: 'error',
      attributes: expect.objectContaining({
        disposition: 'inline',
        outcome: 'failed',
        code: 'STORAGE_UNAVAILABLE',
      }),
    })
    expect(captureEnd).not.toHaveProperty('error')

    const serialized = JSON.stringify(transport.records)
    for (const secret of [
      'RAW_ERROR_SECRET',
      'MESSAGE_SECRET',
      'NAMESPACE_SECRET',
      'TOOL_NAME_SECRET',
      'TOOL_ARGS_SECRET',
      'TOOL_RESULT_SECRET',
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })
})
