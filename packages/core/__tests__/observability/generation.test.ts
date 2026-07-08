import { afterEach, describe, expect, it, vi } from 'vitest'
import { orchestrateGenerate, orchestrateStream, type OrchestrationSpec } from '../../generation'
import type { AnyPromptConfig } from '../../prompt/prompt-types'
import {
  createInMemoryObservabilityTransport,
  createCruxArtifactId,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../observability'
import { resetHooks, updateHooks } from '../../runtime/runtime'
import { expectBalancedGraph } from './helpers/expect-balanced-graph'
import { imagePart, textPart } from '../../content'

describe('generation observability', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

    it('emits an implicit run, generation span, artifacts, edges, and usage for generate', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const spec = generationSpec('generate')
    const result = await orchestrateGenerate(spec, async () => ({
      text: 'hello',
      _meta: {
        usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7, inputTokenDetails: {}, outputTokenDetails: {} },
        cost: 0.00042,
        finishReason: 'stop',
      },
    }))
    await observe.flush()

    expect(result.text).toBe('hello')
    expect(transport.records.map((record) => record.type)).toEqual([
      'run:start',
      'span:start',
      'artifact',
      'edge',
      'span:event',
      'artifact',
      'edge',
      'span:end',
      'run:end',
    ])
    expect(transport.records[1]).toMatchObject({
      type: 'span:start',
      family: 'generation',
      primitive: 'generation.call',
    })
    expect(transport.records[4]).toMatchObject({
      type: 'span:event',
      name: 'usage.observed',
      attributes: { inputTokens: 3, outputTokens: 4, totalTokens: 7, costUsd: 0.00042 },
    })
    expect(transport.records[4]).not.toMatchObject({
      attributes: expect.objectContaining({ cost: expect.any(Number) }),
    })
    const generationEnd = transport.records.find((record) => record.type === 'span:end')
    expect(generationEnd).toMatchObject({
      type: 'span:end',
      metrics: expect.objectContaining({
        'gen.duration_ms': expect.any(Number),
        'gen.output_tokens_per_second': expect.any(Number),
      }),
    })
    expect(generationEnd && 'metrics' in generationEnd ? generationEnd.metrics?.['gen.duration_ms'] : undefined)
      .toBeGreaterThanOrEqual(0)
    expectBalancedGraph(transport.records)
  })

  it('omits generation input and output previews when capture policy disables them', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    updateHooks({
      observabilityCapture: {
        recordInputs: false,
        recordOutputs: false,
      },
    })

    await orchestrateGenerate(generationSpec('generate'), async () => ({
      text: 'hello',
      _meta: {
        usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7, inputTokenDetails: {}, outputTokenDetails: {} },
      },
    }))
    await observe.flush()

    const inputArtifact = transport.records.find((record) => record.type === 'artifact' && record.kind === 'messages')
    const outputArtifact = transport.records.find((record) => record.type === 'artifact' && record.kind === 'output')

    expect(inputArtifact).toMatchObject({
      encoding: 'reference',
      sizeBytes: expect.any(Number),
      hash: expect.any(String),
    })
    expect(inputArtifact).not.toHaveProperty('preview')
    expect(outputArtifact).toMatchObject({
      encoding: 'reference',
      sizeBytes: expect.any(Number),
      hash: expect.any(String),
    })
    expect(outputArtifact).not.toHaveProperty('preview')
  })

  it('keeps multimodal message artifacts base64-free under safe capture', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    updateHooks({
      observabilityCapture: {
        capture: 'safe',
      },
    })

    await orchestrateGenerate(
      {
        ...generationSpec('generate'),
        preparedArgs: {
          ...generationSpec('generate').preparedArgs,
          messages: [
            {
              role: 'user',
              content: [
                textPart('inspect this chart'),
                imagePart({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }),
              ],
            },
          ],
        },
      },
      async () => ({ text: 'hello' }),
    )
    await observe.flush()

    const inputArtifact = transport.records.find((record) => record.type === 'artifact' && record.kind === 'messages')

    expect(inputArtifact).toMatchObject({
      preview: {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'inspect this chart' },
              { type: 'image-data', data: expect.stringContaining('[image image/png 3B sha256:') },
            ],
          },
        ],
      },
    })
    expect(JSON.stringify(inputArtifact)).not.toContain('AQID')
  })

    it('records operation deadlines on timed generation spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    await orchestrateGenerate(
      {
        ...generationSpec('generate'),
        timeout: { totalMs: 60_000 },
      },
      async () => ({
        text: 'hello',
        _meta: {
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, inputTokenDetails: {}, outputTokenDetails: {} },
        },
      }),
    )
    await observe.flush()

    const start = transport.records.find((record) => record.type === 'span:start')
    expect(start).toMatchObject({
      attributes: expect.objectContaining({
        totalTimeoutMs: 60_000,
        deadlineAt: expect.any(String),
      }),
    })
    const deadline = transport.records.find(
      (record) => record.type === 'span:event' && record.name === 'operation.deadline',
    )
    expect(deadline).toMatchObject({
      attributes: expect.objectContaining({
        totalTimeoutMs: 60_000,
        deadlineAt: expect.any(String),
      }),
    })
  })

    it('ends timed generation spans when the provider call never settles', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    await expect(
      orchestrateGenerate(
        {
          ...generationSpec('generate'),
          timeout: { totalMs: 10 },
        },
        async () => new Promise<never>(() => {}),
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError', budget: 'total' })
    await observe.flush()

    const generationEnd = transport.records.find((record) => record.type === 'span:end')
    expect(generationEnd).toMatchObject({
      type: 'span:end',
      status: 'error',
      error: expect.objectContaining({
        name: 'TimeoutError',
      }),
    })
  })

    it('records structured generation objects in the output artifact preview', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    await orchestrateGenerate(generationSpec('generate'), async () => ({
      object: {
        plan: [{ title: 'Soften unverified claims', action: 'mark-needs-verification' }],
      },
      text: 'plan ready',
      _meta: {
        usage: { inputTokens: 3, outputTokens: 8, totalTokens: 11, inputTokenDetails: {}, outputTokenDetails: {} },
      },
    }))
    await observe.flush()

    const outputArtifact = transport.records.find((record) => record.type === 'artifact' && record.kind === 'output')
    expect(outputArtifact).toMatchObject({
      preview: {
        text: 'plan ready',
        object: {
          plan: [{ title: 'Soften unverified claims', action: 'mark-needs-verification' }],
        },
      },
    })
  })

    it('links resolved context artifacts to the generation span that consumes them', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const contextArtifactId = createCruxArtifactId()
    const budgetArtifactId = createCruxArtifactId()

    await orchestrateGenerate(
      {
        ...generationSpec('generate'),
        resolved: {
          settings: {},
          promptBudgetArtifactId: budgetArtifactId,
          systemBlocks: [
            {
              source: 'context:profile',
              text: 'User prefers concise answers.',
              providerCache: false,
              artifactId: contextArtifactId,
            },
          ],
        },
      },
      async () => ({
        text: 'hello',
      }),
    )
    await observe.flush()

    const generationStart = transport.records.find((record) => record.type === 'span:start')
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'edge',
        edgeType: 'consumed',
        from: { kind: 'artifact', id: contextArtifactId },
        to: { kind: 'span', id: generationStart && 'spanId' in generationStart ? generationStart.spanId : '' },
        attributes: expect.objectContaining({ contextSource: 'context:profile' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'edge',
        edgeType: 'consumed',
        from: { kind: 'artifact', id: budgetArtifactId },
        to: { kind: 'span', id: generationStart && 'spanId' in generationStart ? generationStart.spanId : '' },
        attributes: expect.objectContaining({ primitive: 'prompt.budget' }),
      }),
    )
  })

    it('includes prepared request tool names in the messages artifact preview', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    await orchestrateGenerate(
      {
        ...generationSpec('generate'),
        preparedArgs: {
          ...generationSpec('generate').preparedArgs,
          tools: {
            lookupPolicy: {},
            draftReply: {},
          },
        },
      },
      async () => ({
        text: 'hello',
      }),
    )
    await observe.flush()

    const messagesArtifact = transport.records.find(
      (record) => record.type === 'artifact' && record.kind === 'messages',
    )
    expect(messagesArtifact).toMatchObject({
      preview: {
        toolNames: ['lookupPolicy', 'draftReply'],
      },
    })
  })

    it('ends stream spans once with usage metrics when drain happens before completion', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const handle = await orchestrateStream(generationSpec('stream'), async () => ({
      rawStream: streamChunks([{ text: 'hel' }, { text: 'lo' }]),
      extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
      completion: async () => ({
        usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11, inputTokenDetails: {}, outputTokenDetails: {} },
        finishReason: 'stop',
      }),
    }))
    await observe.flush()

    expect(transport.records.map((record) => record.type)).toEqual(['run:start', 'span:start', 'artifact', 'edge'])

    const chunks: unknown[] = []
    for await (const chunk of handle.rawStream as AsyncIterable<unknown>) {
      chunks.push(chunk)
    }
    expect(chunks).toHaveLength(2)
    await observe.flush()
    expect(transport.records.filter((record) => record.type === 'span:event').map((record) => record.name)).toEqual([
      'token.chunk',
    ])
    expect(transport.records.find((record) => record.type === 'span:event' && record.name === 'token.chunk')).toMatchObject({
      attributes: {
        text: 'hello',
        chunkIndex: 0,
        charCount: 5,
        firstDeltaAt: expect.any(String),
        lastDeltaAt: expect.any(String),
      },
    })
    expect(transport.records.map((record) => record.type)).toEqual([
      'run:start',
      'span:start',
      'artifact',
      'edge',
      'span:event',
    ])

    await handle.completion()
    await observe.flush()

    expect(transport.records.map((record) => record.type)).toEqual([
      'run:start',
      'span:start',
      'artifact',
      'edge',
      'span:event',
      'span:event',
      'artifact',
      'edge',
      'span:end',
      'run:end',
    ])
    const spanEnds = transport.records.filter((record) => record.type === 'span:end')
    expect(spanEnds).toHaveLength(1)
    expect(spanEnds[0]).toMatchObject({
      type: 'span:end',
      status: 'ok',
      attributes: {
        streamCompleted: true,
        tokenChunkCount: 1,
      },
      metrics: expect.objectContaining({
        'gen.duration_ms': expect.any(Number),
        'gen.output_tokens_per_second': expect.any(Number),
      }),
    })
    expect(transport.records[1]).toMatchObject({
      type: 'span:start',
      family: 'generation',
      primitive: 'generation.stream',
    })
  })

    it('flushes token chunks on the coalescing timer while a stream remains open', async () => {
    vi.useFakeTimers()
    try {
      const transport = createInMemoryObservabilityTransport()
      setObservabilityTransport(transport)

      const handle = await orchestrateStream(generationSpec('stream'), async () => ({
        rawStream: delayedStreamChunks([{ text: 'hel' }, { text: 'lo' }], 1_000),
        extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
        completion: async () => ({
          usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11, inputTokenDetails: {}, outputTokenDetails: {} },
        }),
      }))

      const iterator = (handle.rawStream as AsyncIterable<unknown>)[Symbol.asyncIterator]()
      await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { text: 'hel' } })

      await vi.advanceTimersByTimeAsync(80)
      await observe.flush()

      const tokenChunks = transport.records.filter(
        (record) => record.type === 'span:event' && record.name === 'token.chunk',
      )
      expect(tokenChunks).toHaveLength(1)
      expect(tokenChunks[0]).toMatchObject({
        attributes: {
          text: 'hel',
          chunkIndex: 0,
          charCount: 3,
        },
      })
      expect(transport.records.some((record) => record.type === 'span:end')).toBe(false)

      const nextChunk = iterator.next()
      await vi.advanceTimersByTimeAsync(1_000)
      await expect(nextChunk).resolves.toMatchObject({ done: false, value: { text: 'lo' } })
      await expect(iterator.next()).resolves.toMatchObject({ done: true })
    } finally {
      vi.useRealTimers()
    }
  })

    it('flushes token chunks immediately when the text cap is reached', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const first = 'a'.repeat(300)
    const second = 'b'.repeat(212)
    const handle = await orchestrateStream(generationSpec('stream'), async () => ({
      rawStream: streamChunks([{ text: first }, { text: second }]),
      extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
      completion: async () => ({
        usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11, inputTokenDetails: {}, outputTokenDetails: {} },
      }),
    }))

    const iterator = (handle.rawStream as AsyncIterable<unknown>)[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.next()
    await observe.flush()

    const tokenChunks = transport.records.filter(
      (record) => record.type === 'span:event' && record.name === 'token.chunk',
    )
    expect(tokenChunks).toHaveLength(1)
    expect(tokenChunks[0]).toMatchObject({
      attributes: {
        text: first + second,
        chunkIndex: 0,
        charCount: 512,
      },
    })

    await iterator.next()
  })

    it('ends stream spans once when completion is read before the raw stream drains', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const handle = await orchestrateStream(generationSpec('stream'), async () => ({
      rawStream: streamChunks([{ text: 'hel' }, { text: 'lo' }]),
      extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
      completion: async () => ({
        usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11, inputTokenDetails: {}, outputTokenDetails: {} },
        streaming: { tokensPerSecond: 12, totalChunks: 2 },
      }),
    }))

    await handle.completion()
    await observe.flush()
    expect(transport.records.some((record) => record.type === 'span:end')).toBe(false)

    for await (const _chunk of handle.rawStream as AsyncIterable<unknown>) {
      void _chunk
    }
    await observe.flush()

    const spanEnds = transport.records.filter((record) => record.type === 'span:end')
    expect(spanEnds).toHaveLength(1)
    expect(spanEnds[0]).toMatchObject({
      type: 'span:end',
      status: 'ok',
      attributes: {
        streamCompleted: true,
        tokenChunkCount: 1,
      },
      metrics: expect.objectContaining({
        'gen.output_tokens_per_second': 12,
      }),
    })
  })

    it('emits canonical usage and streaming metrics when stream completion is read', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const handle = await orchestrateStream(generationSpec('stream'), async () => ({
      rawStream: streamChunks([{ text: 'hel' }, { text: 'lo' }]),
      extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
      completion: async () => ({
        usage: {
          inputTokens: 5,
          outputTokens: 6,
          totalTokens: 11,
          inputTokenDetails: { cacheReadTokens: 2 },
          outputTokenDetails: {},
        },
        cost: 0.00071,
        streaming: { ttftMs: 125, tokensPerSecond: 12, totalChunks: 2 },
      }),
    }))

    for await (const _chunk of handle.rawStream as AsyncIterable<unknown>) {
      void _chunk
      // consume the stream before reading completion metadata
    }
    await handle.completion()
    await observe.flush()

    const usageEvent = transport.records.find(
      (record) => record.type === 'span:event' && record.name === 'usage.observed',
    )
    expect(usageEvent).toMatchObject({
      attributes: {
        inputTokens: 5,
        outputTokens: 6,
        totalTokens: 11,
        cacheReadTokens: 2,
        costUsd: 0.00071,
        ttftMs: 125,
        tokensPerSecond: 12,
      },
    })
    expect(usageEvent).not.toMatchObject({
      attributes: expect.objectContaining({ cost: expect.any(Number) }),
    })
    const generationEnd = transport.records.find((record) => record.type === 'span:end')
    expect(generationEnd).toMatchObject({
      type: 'span:end',
      metrics: expect.objectContaining({
        'gen.duration_ms': expect.any(Number),
        'gen.time_to_first_token_ms': expect.any(Number),
        'gen.output_tokens_per_second': expect.any(Number),
        'gen.time_per_output_chunk_ms': expect.any(Number),
      }),
    })
  })

    it('ends stream spans as errors when the raw stream throws', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const handle = await orchestrateStream(generationSpec('stream'), async () => ({
      rawStream: throwingStream(),
      extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
      completion: async () => ({
        usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11, inputTokenDetails: {}, outputTokenDetails: {} },
        finishReason: 'error',
      }),
    }))

    await expect(async () => {
      for await (const _chunk of handle.rawStream as AsyncIterable<unknown>) {
        // consume until the adapter stream fails
      }
    }).rejects.toThrow('stream failed')
    await observe.flush()

    expect(transport.records.map((record) => record.type)).toEqual([
      'run:start',
      'span:start',
      'artifact',
      'edge',
      'span:event',
      'span:event',
      'artifact',
      'artifact',
      'span:end',
      'run:end',
    ])
    expect(transport.records[5]).toMatchObject({
      type: 'span:event',
      name: 'exception',
      attributes: {
        'exception.message': 'stream failed',
        'exception.type': 'Error',
      },
    })
    expect(transport.records[8]).toMatchObject({
      type: 'span:end',
      status: 'error',
      error: {
        message: 'stream failed',
      },
    })
    expect(transport.records[9]).toMatchObject({
      type: 'run:end',
      status: 'error',
    })
  })

    it('ends stream spans as cancelled when the consumer stops early', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const handle = await orchestrateStream(generationSpec('stream'), async () => ({
      rawStream: streamChunks([{ text: 'hel' }, { text: 'lo' }]),
      extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
      completion: async () => ({
        usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11, inputTokenDetails: {}, outputTokenDetails: {} },
      }),
    }))

    for await (const _chunk of handle.rawStream as AsyncIterable<unknown>) {
      void _chunk
      break
    }
    await observe.flush()

    const spanEnd = transport.records.find((record) => record.type === 'span:end')
    expect(spanEnd).toMatchObject({
      type: 'span:end',
      status: 'cancelled',
      attributes: {
        streamCompleted: false,
        tokenChunkCount: 1,
        streamFinalizedReason: 'return',
      },
    })
  })

    it('ends stream spans with available metrics when completion is never awaited', async () => {
    vi.useFakeTimers()
    try {
      const transport = createInMemoryObservabilityTransport()
      setObservabilityTransport(transport)

      const handle = await orchestrateStream(generationSpec('stream'), async () => ({
        rawStream: streamChunks([{ text: 'hel' }, { text: 'lo' }]),
        extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
        completion: async () => ({
          usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11, inputTokenDetails: {}, outputTokenDetails: {} },
        }),
      }))

      for await (const _chunk of handle.rawStream as AsyncIterable<unknown>) {
        void _chunk
      }
      await observe.flush()
      expect(transport.records.some((record) => record.type === 'span:end')).toBe(false)

      await vi.advanceTimersByTimeAsync(10_000)
      await observe.flush()

      const spanEnd = transport.records.find((record) => record.type === 'span:end')
      expect(spanEnd).toMatchObject({
        type: 'span:end',
        status: 'ok',
        attributes: {
          streamCompleted: true,
          tokenChunkCount: 1,
          streamFinalizedReason: 'timeout',
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

function generationSpec(operation: 'generate' | 'stream'): OrchestrationSpec<Record<string, unknown>> {
  return {
    promptId: 'support.reply',
    promptConfig: {} as AnyPromptConfig,
    preparedArgs: {
      model: 'gpt-4o',
      system: 'You help.',
      messages: [{ role: 'user', content: 'Hello' }],
    },
    model: 'gpt-4o',
    input: { message: 'Hello' },
    operation,
    provider: 'openai',
    outputMode: 'text',
  }
}

async function* streamChunks(chunks: readonly unknown[]): AsyncIterable<unknown> {
  for (const chunk of chunks) {
    yield chunk
  }
}

async function* delayedStreamChunks(chunks: readonly unknown[], delayMs: number): AsyncIterable<unknown> {
  for (let index = 0; index < chunks.length; index += 1) {
    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
    yield chunks[index]
  }
}

async function* throwingStream(): AsyncIterable<unknown> {
  yield { text: 'hel' }
  throw new Error('stream failed')
}
