/**
 * Type-level contract for the Retrieval & RAG beta public API.
 *
 * Runs under `tsc --noEmit`; `expectTypeOf` assertions and
 * `@ts-expect-error` markers carry the stable beta contract.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import type { DenseEmbedding } from '../embedding'
import type { Corpus } from '../indexing'
import { inMemoryRecordStore, inMemoryVectorStore } from '../storage'
import * as retrieval from '../retrieval'
import {
  compressToBudget,
  expandParents,
  fanout,
  knowledgeBase,
  rerank,
  retrievalRecipe,
  retrievalStep,
  retrieve,
  rewriteQuery,
} from '../retrieval'
import type {
  Grounding,
  KnowledgeBase,
  RecipeTrace,
  RetrievalModel,
  RetrievalRecipe,
  RetrievalStep,
  RetrieveRequest,
  Retriever,
  RetrieverHit,
  RetrieverTools,
} from '../retrieval'
import type { ToolDef } from '../types/tool'

declare const corpus: Corpus
declare const embeddings: DenseEmbedding
declare const model: RetrievalModel

const docs = knowledgeBase({
  id: 'docs',
  corpus,
})

expectTypeOf(docs).toEqualTypeOf<KnowledgeBase>()
expectTypeOf(docs.id).toEqualTypeOf<string>()
expectTypeOf(docs.retriever()).toEqualTypeOf<Retriever>()
expectTypeOf(docs.grounding()).toEqualTypeOf<Grounding>()
expectTypeOf(docs.tools()).toEqualTypeOf<RetrieverTools>()
expectTypeOf(docs.scope({ namespace: 'tenant-a' })).toMatchTypeOf<Omit<KnowledgeBase, 'scope'>>()
expectTypeOf(docs.inspect()).toMatchTypeOf<{
  id: string
  namespace: string
}>()

const metadataSchema = z.object({
  section: z.enum(['guide', 'reference', 'api']),
  public: z.boolean(),
  rank: z.number().optional(),
})

const configuredDocs = knowledgeBase({
  id: 'configured-docs',
  corpus,
  records: inMemoryRecordStore(),
  vectors: inMemoryVectorStore(),
  embeddings,
  metadataSchema,
})

const configuredRetriever = configuredDocs.retriever({
  filter: {
    section: 'guide',
    public: true,
    rank: 1,
  },
})

expectTypeOf(configuredRetriever).toEqualTypeOf<
  Retriever<{ readonly section?: 'guide' | 'reference' | 'api'; readonly public?: boolean; readonly rank?: number }>
>()

configuredRetriever.retrieve({
  query: 'How do refunds work?',
  limit: 5,
  threshold: 0.2,
  filter: { section: 'reference' },
  mode: 'hybrid',
  fusion: { strategy: 'rrf', k: 60 },
  caller: { promptId: 'answer-docs' },
})

// @ts-expect-error metadata filters are constrained to schema keys.
configuredDocs.retriever({ filter: { tenant: 'acme' } })
// @ts-expect-error enum metadata filters preserve literal values.
configuredRetriever.retrieve({ query: 'x', filter: { section: 'blog' } })
// @ts-expect-error only implemented fusion strategies are exposed.
configuredRetriever.retrieve({ query: 'x', fusion: { strategy: 'dbsf' } })

const custom = retrieval.retriever({
  id: 'custom-docs',
  namespace: 'custom-docs',
  retrieve: async (query) => [
    {
      namespace: 'custom-docs',
      sourceId: 'guide.md',
      chunkId: 'chunk-1',
      content: query,
      metadata: {},
      score: 1,
      provenance: { rawScore: 1 },
    },
  ],
})

expectTypeOf(custom.retrieve('refund policy')).resolves.toEqualTypeOf<RetrieverHit[]>()

const exactRequest = {
  query: 'refund policy',
  filter: { section: 'api' },
} satisfies RetrieveRequest<{ readonly section?: 'guide' | 'reference' | 'api' }>
void exactRequest

const customHitStep = retrievalStep({
  id: 'only-public',
  phase: { in: 'hits', out: 'hits' },
  run: ({ hits }) => ({ hits }),
})

expectTypeOf(customHitStep).toEqualTypeOf<RetrievalStep<'hits', 'hits'>>()

expectTypeOf(rewriteQuery()).toEqualTypeOf<RetrievalStep<'queries', 'queries'>>()
expectTypeOf(fanout({ maxQueries: 4 })).toEqualTypeOf<RetrievalStep<'queries', 'queries'>>()
expectTypeOf(rerank({ topK: 8, model })).toEqualTypeOf<RetrievalStep<'hits', 'hits'>>()
expectTypeOf(expandParents()).toEqualTypeOf<RetrievalStep<'hits', 'hits'>>()
expectTypeOf(compressToBudget({ tokens: 3_500, model })).toEqualTypeOf<RetrievalStep<'hits', 'hits'>>()

const recipe = retrievalRecipe({
  id: 'docs-hybrid-cited-answer',
  retriever: configuredRetriever,
  model,
  steps: [rewriteQuery(), fanout({ maxQueries: 4 }), retrieve({ limit: 20 }), rerank({ topK: 8 }), customHitStep],
})

expectTypeOf(recipe).toEqualTypeOf<RetrievalRecipe>()
expectTypeOf(recipe.asRetriever()).toEqualTypeOf<Retriever>()
expectTypeOf(recipe.retrieveWithTrace('refunds')).resolves.toEqualTypeOf<{
  hits: RetrieverHit[]
  trace: RecipeTrace
}>()

const defaultTools = recipe.asTools()
expectTypeOf(defaultTools).toMatchTypeOf<{ search: ToolDef }>()
expectTypeOf(defaultTools).not.toHaveProperty('getSource')

const prefixedTools = recipe.asTools({
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

expectTypeOf<RetrieverTools<{ prefix: true; include: readonly ['search'] }>>().toMatchTypeOf<
  Record<string, ToolDef>
>()

recipe.asGrounding({
  citations: {
    required: true,
    quotes: 'required',
  },
})

// @ts-expect-error provider SDK model objects must be bound by adapter packages first.
retrievalRecipe({ id: 'raw-provider-model', retriever: configuredRetriever, model: {}, steps: [retrieve()] })

// @ts-expect-error anonymous retrieval pipelines are not part of the stable beta API.
retrieval.retrievalPipeline
// @ts-expect-error public retrieval stages are replaced by typed recipe steps.
retrieval.retrievalStage
// @ts-expect-error per-retriever reranker authoring is replaced by rerank recipe steps.
retrieval.reranker
