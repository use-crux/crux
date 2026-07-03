import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { context } from '../prompt/context'
import { citationSchema, grounding } from '../citations'
import { prompt } from '../prompt/prompt'
import { embedding, embeddingCache, normalizeText } from '../embedding'
import { retriever, retrievalRecipe, retrievalStep, retrieve } from '../retrieval'
import { inMemoryRecordStore } from '../storage'
import type { RetrieverTools } from '../retrieval'
import type { ToolDef } from '../types/tool'

const localeContext = context({
  id: 'locale',
  input: z.object({
    locale: z.enum(['en', 'nl']),
  }),
  system: ({ input }) => `Answer in ${input.locale}.`,
})

const docs = retriever({
  id: 'product-docs',
  namespace: 'product-docs',
  async retrieve(query) {
    return [
      {
        namespace: 'product-docs',
        sourceId: 'guide.md',
        chunkId: 'chunk-1',
        content: query,
        metadata: {},
        score: 1,
      },
    ]
  },
})

const recipe = retrievalRecipe({
  id: 'product-docs-answer',
  retriever: docs,
  steps: [
    retrieve({ limit: 4 }),
    retrievalStep({
      id: 'only-public',
      phase: { in: 'hits', out: 'hits' },
      run: ({ hits }) => ({ hits }),
    }),
  ],
})

expectTypeOf(recipe.inspect()).toMatchTypeOf<{
  id: string
  stepCount: number
  retrieverIds: readonly string[]
}>()

const recipeRetriever = recipe.asRetriever()

const groundedDocs = grounding({
  id: 'docs',
  retriever: recipeRetriever,
  query: ({ input }) => String(input.question),
  citations: {
    required: true,
    quotes: 'required',
  },
})

const recipeGrounding = recipe.asGrounding({
  citations: {
    required: true,
    quotes: 'required',
  },
})
void recipeGrounding

const answer = prompt({
  id: 'answer',
  use: [localeContext, groundedDocs],
  input: z.object({
    question: z.string(),
  }),
  output: z.object({
    answer: z.string(),
    citations: z.array(citationSchema),
  }),
  system: ({ input }) => `Question: ${input.question}; locale: ${input.locale}`,
})

answer.resolve({
  input: {
    question: 'How do refunds work?',
    locale: 'en',
  },
})

answer.resolve({
  // @ts-expect-error context input is merged into the prompt input.
  input: {
    question: 'How do refunds work?',
  },
})

const defaultTools = docs.asTools()
expectTypeOf(defaultTools).toMatchTypeOf<{ search: ToolDef }>()
expectTypeOf(defaultTools).not.toHaveProperty('getSource')

const selectedTools = docs.asTools({
  include: ['search', 'getSource'],
})
expectTypeOf(selectedTools).toMatchTypeOf<{
  search: ToolDef
  getSource: ToolDef
}>()

const prefixedTools = docs.asTools({
  prefix: 'docs',
  include: ['search', 'getSource'],
})
expectTypeOf(prefixedTools).toMatchTypeOf<{
  docsSearch: ToolDef
  docsGetSource: ToolDef
}>()

expectTypeOf<RetrieverTools<{ prefix: 'kb'; include: readonly ['search'] }>>().toEqualTypeOf<{
  kbSearch: ToolDef
}>()

const cache = embeddingCache({ records: inMemoryRecordStore(), namespace: 'type-test' })

const denseEmbedding = embedding({
  kind: 'dense',
  name: 'dense',
  dimensions: 2,
  maxInputTokens: 100,
  batch: { maxSize: 10, concurrency: 2 },
  preprocess: normalizeText({ trim: true, collapseWhitespace: true }),
  truncate: { strategy: 'chars', maxChars: 200 },
  retry: { maxAttempts: 2, baseDelayMs: 0 },
  cache,
  rateLimit: { concurrency: 1 },
  embed: async (texts) => texts.map((text) => [text.length, text.length]),
})

expectTypeOf(denseEmbedding.embed('x')).toEqualTypeOf<Promise<number[]>>()
expectTypeOf(denseEmbedding.embedMany(['x'])).toEqualTypeOf<Promise<number[][]>>()
expectTypeOf(denseEmbedding.asEmbedFn()).toEqualTypeOf<(text: string) => Promise<number[]>>()

const sparseEmbedding = embedding({
  kind: 'sparse',
  name: 'sparse',
  maxInputTokens: 100,
  batch: { maxSize: 10 },
  preprocess: [normalizeText({ trim: true })],
  cache,
  embed: async (texts) =>
    texts.map((text) => ({
      indices: [0],
      values: [text.length],
    })),
})

expectTypeOf(sparseEmbedding.embed('x')).toEqualTypeOf<
  Promise<{ readonly indices: readonly number[]; readonly values: readonly number[] }>
>()
expectTypeOf(sparseEmbedding).not.toHaveProperty('asEmbedFn')
