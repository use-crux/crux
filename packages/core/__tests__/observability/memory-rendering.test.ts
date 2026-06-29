import { afterEach, describe, expect, it } from 'vitest'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../observability'
import { memory, memoryBlock } from '../../memory'

describe('memory rendering observability', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('records memory render budget decisions without exposing raw namespace values', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const mem = memory({
      id: 'budgeted',
      namespace: 'tenant:secret',
      budget: { maxTokens: 6 },
      blocks: [
        memoryBlock({
          id: 'important',
          kind: 'custom',
          priority: 90,
          budget: { maxTokens: 2 },
          render: () => 'alpha beta gamma',
        }),
        memoryBlock({
          id: 'detail',
          kind: 'custom',
          priority: 10,
          render: () => 'low priority detail',
        }),
      ],
    })

    await observe.run({ name: 'render budgeted memory', rootPrimitive: 'prompt.resolve' }, async () => {
      await mem.asContext().systemFn({})
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'memory.read',
        name: 'budgeted.render',
        attributes: expect.objectContaining({
          memoryId: 'budgeted',
          memoryType: 'memory',
          operation: 'render',
          namespaceHash: expect.any(String),
          budgetMaxTokens: 6,
          budgetIncludedBlocks: ['important'],
          budgetTrimmedBlocks: ['important'],
          budgetDroppedBlocks: ['detail'],
        }),
      }),
    )
    expect(transport.records).not.toContainEqual(
      expect.objectContaining({
        attributes: expect.objectContaining({ namespace: 'tenant:secret' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'memory.snapshot',
        preview: expect.objectContaining({
          kind: 'memory.snapshot',
          memoryType: 'memory',
          operation: 'render',
          budget: expect.objectContaining({
            maxTokens: 6,
            includedBlocks: ['important'],
            trimmedBlocks: ['important'],
            droppedBlocks: ['detail'],
          }),
        }),
      }),
    )
  })
})
