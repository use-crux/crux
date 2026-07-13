import { afterEach, describe, expect, it, vi } from 'vitest'
import { prompt } from '@use-crux/core'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '@use-crux/core/observability'
import { createOpenAI } from '../src'
import { client, completion, emptyStream } from './media-input.fixtures'

const mediaPrompt = prompt({ id: 'openai-media-budget', prompt: 'Inspect.' })
const messages = [{
  role: 'user' as const,
  content: [{ type: 'image' as const, source: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }],
}]

afterEach(() => resetObservabilityRuntime())

describe('OpenAI media token budgeting', () => {
  it.each(['generate', 'stream'] as const)('records a safe fallback estimate for %s', async (mode) => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    const create = vi.fn(async (request: unknown) =>
      isStreamingRequest(request) ? emptyStream() : completion('done'))
    const adapter = createOpenAI(client({ create }))

    if (mode === 'generate') {
      await adapter.generate(mediaPrompt, { model: 'gpt-4o', messages, tokenBudget: 10_000 })
    } else {
      await adapter.stream(mediaPrompt, { model: 'gpt-4o', messages, tokenBudget: 10_000 })
    }
    await observe.flush()

    expect(transport.records).toContainEqual(expect.objectContaining({
      type: 'span:event',
      name: 'input.tokens.estimated',
      attributes: expect.objectContaining({
        estimatedInputTokens: expect.any(Number),
        estimatedMediaTokens: expect.any(Number),
        estimateUsedFallback: true,
        tokenBudget: 10_000,
      }),
    }))
    const serialized = JSON.stringify(transport.records)
    expect(serialized).not.toContain('AQID')
  })
})

function isStreamingRequest(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { stream?: unknown }).stream === true
}
