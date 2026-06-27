import { afterEach, describe, expect, it } from 'vitest'
import { orchestrateGenerate, orchestrateStream, type OrchestrationSpec } from '../../generation'
import type { AnyPromptConfig } from '../../types'
import {
  createInMemoryObservabilityTransport,
  createCruxArtifactId,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../observability'

describe('generation observability', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('emits an implicit run, generation span, artifacts, edges, and usage for generate', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const spec = generationSpec('generate')
    const result = await orchestrateGenerate(spec, async () => ({
      text: 'hello',
      _meta: {
        usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
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
  })

  it('records operation deadlines on timed generation spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    await orchestrateGenerate(
      {
        ...generationSpec('generate'),
        timeoutMs: 60_000,
      },
      async () => ({
        text: 'hello',
        _meta: {
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      }),
    )
    await observe.flush()

    const start = transport.records.find((record) => record.type === 'span:start')
    expect(start).toMatchObject({
      attributes: expect.objectContaining({
        timeoutMs: 60_000,
        deadlineAt: expect.any(String),
      }),
    })
    const deadline = transport.records.find(
      (record) => record.type === 'span:event' && record.name === 'operation.deadline',
    )
    expect(deadline).toMatchObject({
      attributes: expect.objectContaining({
        timeoutMs: 60_000,
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
          timeoutMs: 10,
        },
        async () => new Promise<never>(() => {}),
      ),
    ).rejects.toThrow('Fallback attempt timed out')
    await observe.flush()

    const generationEnd = transport.records.find((record) => record.type === 'span:end')
    expect(generationEnd).toMatchObject({
      type: 'span:end',
      status: 'error',
      error: expect.objectContaining({
        name: 'AbortError',
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
        usage: { inputTokens: 3, outputTokens: 8, totalTokens: 11 },
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
    const contextArtifactId = createCruxArtifactId('context_profile')
    const budgetArtifactId = createCruxArtifactId('budget')

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

  it('ends stream spans when the raw stream completes before completion is read', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const handle = await orchestrateStream(generationSpec('stream'), async () => ({
      rawStream: streamChunks([{ text: 'hel' }, { text: 'lo' }]),
      extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
      completion: async () => ({
        usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11 },
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
      'token.delta',
      'token.delta',
    ])
    expect(transport.records.map((record) => record.type)).toEqual([
      'run:start',
      'span:start',
      'artifact',
      'edge',
      'span:event',
      'span:event',
      'span:end',
      'run:end',
    ])
    expect(transport.records[6]).toMatchObject({
      type: 'span:end',
      status: 'ok',
      attributes: {
        streamCompleted: true,
        tokenDeltaCount: 2,
      },
    })

    await handle.completion()
    await observe.flush()

    expect(transport.records.map((record) => record.type)).toEqual([
      'run:start',
      'span:start',
      'artifact',
      'edge',
      'span:event',
      'span:event',
      'span:end',
      'run:end',
      'span:event',
      'artifact',
      'edge',
    ])
    expect(transport.records[1]).toMatchObject({
      type: 'span:start',
      family: 'generation',
      primitive: 'generation.stream',
    })
  })

  it('emits canonical usage and streaming metrics when stream completion is read', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const handle = await orchestrateStream(generationSpec('stream'), async () => ({
      rawStream: streamChunks([{ text: 'hel' }, { text: 'lo' }]),
      extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
      completion: async () => ({
        usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11, cacheReadTokens: 2 },
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
  })

  it('ends stream spans as errors when the raw stream throws', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const handle = await orchestrateStream(generationSpec('stream'), async () => ({
      rawStream: throwingStream(),
      extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
      completion: async () => ({
        usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11 },
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

async function* throwingStream(): AsyncIterable<unknown> {
  yield { text: 'hel' }
  throw new Error('stream failed')
}
