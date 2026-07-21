import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { loopRuntimeAdapter } from '../../src/adapter/define-executor'
import { fakeLoopRuntime } from '../../src/adapter/testing'
import { memory, memoryBlock } from '../../src/memory'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import { prompt } from '../../src/prompt/prompt'
import { config } from '../../src/runtime/config'
import { resetHooks } from '../../src/runtime/runtime'
import { testAdapter } from '../memory/capture/fixtures'

describe('memory capture observability', () => {
  afterEach(() => {
    resetHooks()
    resetObservabilityRuntime()
  })

  it('records one completed inline capture inside the owning generation run', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const mem = memory({
      id: 'conversation',
      namespace: 'thread:1',
      capture: { mode: 'inline' },
      blocks: [memoryBlock({ id: 'capture', captureTurn: async () => {} })],
    })
    const boundPrompt = prompt({
      id: 'memory-capture-observation',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })

    await testAdapter().generate(boundPrompt, {
      model: 'model-1',
      input: { message: 'Hello' },
    })
    await observe.flush()

    const captureStarts = transport.records.filter(
      (record) =>
        record.type === 'span:start' && record.primitive === 'memory.capture',
    )
    const captureEnds = transport.records.filter(
      (record) =>
        record.type === 'span:end' &&
        captureStarts.some((start) => start.spanId === record.spanId),
    )

    expect(captureStarts).toHaveLength(1)
    expect(captureStarts[0]).toMatchObject({
      family: 'memory',
      definitionRefs: [
        { id: 'memory:conversation', kind: 'memory', role: 'invoked-memory' },
      ],
      attributes: {
        memoryId: 'conversation',
        operation: 'turn',
        requestedMode: 'inline',
        sequence: 1,
        blockCount: 1,
        toolEventCount: 0,
      },
    })
    expect(captureEnds).toHaveLength(1)
    expect(captureEnds[0]).toMatchObject({
      status: 'ok',
      attributes: expect.objectContaining({
        disposition: 'inline',
        outcome: 'completed',
      }),
    })
    const generationStart = transport.records.find(
      (record) =>
        record.type === 'span:start' && record.primitive === 'generation.call',
    )
    expect(captureStarts[0]).toMatchObject({
      runId: generationStart?.runId,
      parentSpanId: generationStart?.spanId,
    })
  })

  it('parents SDK-owned generation capture to generation.call', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const mem = memory({
      id: 'sdk-conversation',
      namespace: 'thread:1',
      capture: { mode: 'inline' },
      blocks: [memoryBlock({ id: 'capture', captureTurn: async () => {} })],
    })
    const boundPrompt = prompt({
      id: 'sdk-memory-capture-observation',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })
    const fake = fakeLoopRuntime({ loops: [[{ text: 'Hello' }]] })

    await loopRuntimeAdapter(fake.runtime).generate(boundPrompt, {
      model: 'fake:model-1',
      input: { message: 'Hello' },
    })
    await observe.flush()

    const generationStart = transport.records.find(
      (record) =>
        record.type === 'span:start' && record.primitive === 'generation.call',
    )
    const captureStart = transport.records.find(
      (record) =>
        record.type === 'span:start' && record.primitive === 'memory.capture',
    )
    expect(captureStart).toMatchObject({
      runId: generationStart?.runId,
      parentSpanId: generationStart?.spanId,
      attributes: expect.objectContaining({ memoryId: 'sdk-conversation' }),
    })
  })

  it('accepts capture after a middleware replacement bypasses the provider', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const mem = memory({
      id: 'cached-conversation',
      namespace: 'thread:1',
      capture: { mode: 'inline' },
      blocks: [memoryBlock({ id: 'capture', captureTurn: async () => {} })],
    })
    const boundPrompt = prompt({
      id: 'cached-memory-capture-observation',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })
    const runtime = config({
      generation: {
        middleware: async () => ({
          text: 'cached answer',
          messages: [],
          _meta: { finishReason: 'stop' },
        }),
      },
    })

    try {
      const result = await testAdapter().generate(boundPrompt, {
        model: 'model-1',
        input: { message: 'Hello' },
      })
      await observe.flush()

      expect(result.text).toBe('cached answer')
      const outputIndex = transport.records.findIndex(
        (record) => record.type === 'artifact' && record.kind === 'output',
      )
      const captureIndex = transport.records.findIndex(
        (record) =>
          record.type === 'span:start' && record.primitive === 'memory.capture',
      )
      expect(outputIndex).toBeGreaterThanOrEqual(0)
      expect(captureIndex).toBeGreaterThan(outputIndex)
    } finally {
      runtime.dispose()
    }
  })

  it('parents core-owned stream completion capture to generation.stream', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const mem = memory({
      id: 'stream-conversation',
      namespace: 'thread:1',
      capture: { mode: 'inline' },
      blocks: [memoryBlock({ id: 'capture', captureTurn: async () => {} })],
    })
    const boundPrompt = prompt({
      id: 'stream-memory-capture-observation',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })

    const result = await testAdapter('streamed answer').stream(boundPrompt, {
      model: 'model-1',
      input: { message: 'Hello' },
    })
    for await (const _chunk of result.textStream) {
      // Draining preserves the public stream lifecycle before completion.
    }
    await result.completion
    await observe.flush()

    const generationStart = transport.records.find(
      (record) =>
        record.type === 'span:start' && record.primitive === 'generation.stream',
    )
    const captureStart = transport.records.find(
      (record) =>
        record.type === 'span:start' && record.primitive === 'memory.capture',
    )
    expect(captureStart).toMatchObject({
      runId: generationStart?.runId,
      parentSpanId: generationStart?.spanId,
      attributes: expect.objectContaining({ memoryId: 'stream-conversation' }),
    })
  })

  it('parents SDK-owned stream completion capture to generation.stream', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const mem = memory({
      id: 'sdk-stream-conversation',
      namespace: 'thread:1',
      capture: { mode: 'inline' },
      blocks: [memoryBlock({ id: 'capture', captureTurn: async () => {} })],
    })
    const boundPrompt = prompt({
      id: 'sdk-stream-memory-capture-observation',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })
    const fake = fakeLoopRuntime({ streams: [['Hello']] })

    const result = await loopRuntimeAdapter(fake.runtime).stream(boundPrompt, {
      model: 'fake:model-1',
      input: { message: 'Hello' },
    })
    await result.completion()
    await observe.flush()

    const generationStart = transport.records.find(
      (record) =>
        record.type === 'span:start' && record.primitive === 'generation.stream',
    )
    const captureStart = transport.records.find(
      (record) =>
        record.type === 'span:start' && record.primitive === 'memory.capture',
    )
    expect(captureStart).toMatchObject({
      runId: generationStart?.runId,
      parentSpanId: generationStart?.spanId,
      attributes: expect.objectContaining({ memoryId: 'sdk-stream-conversation' }),
    })
  })
})
