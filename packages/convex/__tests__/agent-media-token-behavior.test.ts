import type { LanguageModelV3 } from '@ai-sdk/provider'
import { prompt } from '@use-crux/core'
import { describe, expect, it } from 'vitest'
import { createProfileBackedAgentLifecycle } from '../src/agent/lifecycle'
import { inMemoryRecordStore } from '../src/memory'
import { FakeConvexAgentDriver } from './fixtures/fakeAgentDriver'

describe('Convex Agent media token behavior', () => {
  it.each(['generate', 'stream'] as const)('keeps %s usage owned by the framework loop', async (mode) => {
    const driver = new FakeConvexAgentDriver()
    const result = { text: 'done', usage: { inputTokens: 640, outputTokens: 4, totalTokens: 644 } }
    driver.textResult = result
    driver.streamResult = result
    const lifecycle = createProfileBackedAgentLifecycle({
      components: { crux: { marker: 'crux' } as never, agent: { marker: 'agent' } },
      driver,
      languageModel: model(),
      prompt: prompt({
        id: 'convex-media-token-behavior',
        messages: () => [{
          role: 'user',
          content: [{
            type: 'image',
            source: {
              type: 'data',
              data: new Uint8Array([1, 2, 3]),
              mediaType: 'image/png',
              width: 800,
              height: 600,
            },
          }],
        }],
      }),
      storage: () => inMemoryRecordStore(),
    })
    const request = { ctx: {}, target: { threadId: 'thread-media' }, args: { input: {} } }

    const actual = mode === 'generate'
      ? await lifecycle.invokeText(request)
      : await lifecycle.invokeStream(request)

    expect(actual).toBe(result)
    expect(driver.generatedTextCalls).toHaveLength(mode === 'generate' ? 1 : 0)
    expect(driver.streamedTextCalls).toHaveLength(mode === 'stream' ? 1 : 0)
    expect(driver.generatedObjectCalls).toHaveLength(0)
    expect(driver.streamedObjectCalls).toHaveLength(0)
    expect(driver.definitions).toHaveLength(1)
  })
})

function model(): LanguageModelV3 {
  return { provider: 'anthropic', modelId: 'claude-sonnet-4-5', specificationVersion: 'v3' } as LanguageModelV3
}
