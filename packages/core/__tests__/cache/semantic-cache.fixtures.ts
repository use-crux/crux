import { z } from 'zod'

import { embedding } from '../../src/embedding'
import { prompt } from '../../src/prompt/prompt'
import { applyPlugins, type CruxPlugin } from '../../src/runtime/plugin'
import { getHooks, setHooks } from '../../src/runtime/runtime'

export function denseEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'test-dense',
    dimensions: 3,
    maxInputTokens: 8192,
    batch: { maxSize: 16 },
    embed: async (texts) => ({
      embeddings: texts.map((text) => {
        if (text.includes('billing') || text.includes('invoice')) return [1, 0, 0]
        if (text.includes('refund')) return [0, 1, 0]
        return [0, 0, 1]
      }),
    }),
  })
}

export function sparseEmbedding() {
  return embedding({
    kind: 'sparse',
    name: 'test-sparse',
    maxInputTokens: 8192,
    batch: { maxSize: 16 },
    embed: async (texts) => texts.map(() => ({ indices: [1], values: [1] })),
  })
}

export function installSemanticCachePlugins(...plugins: CruxPlugin[]) {
  const applied = applyPlugins(plugins, getHooks())
  setHooks(applied.hooks)
  return applied
}

export function cacheablePrompt() {
  return prompt({
    id: 'intent',
    input: z.object({ message: z.string(), userId: z.string() }),
    output: z.object({ intent: z.string() }),
    cache: { semantic: { version: 'v1', query: ({ input }) => String(input.message) } },
    prompt: ({ input }) => input.message,
  })
}
