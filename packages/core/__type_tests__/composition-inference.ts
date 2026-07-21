import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { context } from '../src/prompt/context'
import { citationSchema, grounding } from '../src/citations'
import { prompt } from '../src/prompt/prompt'
import { embedding, embeddingCache, normalizeText } from '../src/embedding'
import { retriever, retrievalRecipe, retrievalStep, retrieve } from '../src/retrieval'
import { inMemoryRecordStore } from '../src/storage'
import type { RetrievalToolDef, RetrieverTools } from '../src/retrieval'

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
        source: { id: 'guide.md' },
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
expectTypeOf(defaultTools).toMatchTypeOf<{ search: RetrievalToolDef }>()
expectTypeOf(defaultTools).not.toHaveProperty('getSource')

const selectedTools = docs.asTools({
  include: ['search', 'getSource'],
})
expectTypeOf(selectedTools).toMatchTypeOf<{
  search: RetrievalToolDef
  getSource: RetrievalToolDef
}>()

const prefixedTools = docs.asTools({
  prefix: 'docs',
  include: ['search', 'getSource'],
})
expectTypeOf(prefixedTools).toMatchTypeOf<{
  docsSearch: RetrievalToolDef
  docsGetSource: RetrievalToolDef
}>()

expectTypeOf<RetrieverTools<{ prefix: 'kb'; include: readonly ['search'] }>>().toEqualTypeOf<{
  kbSearch: RetrievalToolDef
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
  embed: async (inputs) => inputs.map((input) => {
    if (input.type !== 'text') throw new Error('Expected text input.')
    return [input.text.length, input.text.length]
  }),
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
