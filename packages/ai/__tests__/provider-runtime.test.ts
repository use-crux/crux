/**
 * Public provider runtime boundary tests for `@use-crux/ai`.
 */

import { describe, expect, it } from 'vitest'
import { prompt as makePrompt } from '@use-crux/core'
import { z } from 'zod'
import { aiSdkProviderRuntime } from '../src/profile'
import { emissionModel } from './mock-model'
import { scriptedGateway } from './scripted-gateway'

describe('aiSdkProviderRuntime', () => {
  it('exposes the AI SDK as a provider runtime peer', async () => {
    const scripted = scriptedGateway({ generateText: [{ text: 'provider runtime text' }] })
    const runtime = aiSdkProviderRuntime.create(scripted.gateway)
    const model = emissionModel([{ text: 'unused by scripted gateway' }])
    const profilePrompt = makePrompt({
      id: 'ai-sdk-provider-runtime-text',
      input: z.object({ instruction: z.string() }),
      prompt: ({ input }) => input.instruction,
    })

    const result = await runtime.generate(profilePrompt, {
      model,
      input: { instruction: 'Write with the provider runtime' },
    })

    expect(aiSdkProviderRuntime.id).toBe('ai-sdk')
    expect(runtime.executorId).toBe('ai-sdk')
    expect(result.text).toBe('provider runtime text')
    expect(scripted.calls.generateText[0]?.model).toBe(model)
  })

  it('binds embedding, retrieval model, and reranking extensions through the provider runtime', async () => {
    const scripted = scriptedGateway({
      generateText: [{ text: 'retrieval text' }],
      generateObject: [{ object: { answer: 'retrieval object' } }],
      embedMany: [{ embeddings: [[0.5, 0.5]], tokens: 6 }],
      rerank: [{ ranking: [{ originalIndex: 1, score: 0.9 }] }],
    })
    const runtime = aiSdkProviderRuntime.create(scripted.gateway)

    const dense = runtime.embedding({
      name: 'runtime-embed',
      model: 'embed-model' as never,
      dimensions: 2,
      maxInputTokens: 128,
    })
    const reranker = runtime.reranker({ name: 'runtime-rerank', model: 'rerank-model' as never })
    const retrieval = runtime.retrievalModel({ model: 'language-model' as never })

    await expect(dense.embedMany(['hello'])).resolves.toEqual([[0.5, 0.5]])
    await expect(retrieval.generateText({ prompt: 'retrieve text' })).resolves.toEqual({ text: 'retrieval text' })
    await expect(
      retrieval.generateObject({
        prompt: 'retrieve object',
        schema: z.object({ answer: z.string() }),
      }),
    ).resolves.toEqual({ object: { answer: 'retrieval object' } })
    await expect(
      reranker.rerank({
        query: 'needle',
        hits: [
          { namespace: 'n', source: { id: 'a' }, chunkId: 'a1', content: 'first', metadata: {}, score: 0.1 },
          { namespace: 'n', source: { id: 'b' }, chunkId: 'b1', content: 'second', metadata: {}, score: 0.2 },
        ],
      }),
    ).resolves.toEqual([
      { namespace: 'n', source: { id: 'b' }, chunkId: 'b1', content: 'second', metadata: {}, score: 0.9 },
    ])
    expect(scripted.calls.embedMany[0]?.values).toEqual(['hello'])
    expect(scripted.calls.generateText[0]?.model).toBe('language-model')
    expect(scripted.calls.generateObject[0]?.model).toBe('language-model')
    expect(scripted.calls.rerank[0]?.query).toBe('needle')
  })
})
