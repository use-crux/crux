/**
 * Type-level contract for the Retrieval & RAG beta public API.
 *
 * Runs under `tsc --noEmit`; `expectTypeOf` assertions and
 * `@ts-expect-error` markers carry the stable beta contract.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import type { Citation } from '../src/citations'
import type { DenseEmbedding, EmbeddingModality } from '../src/embedding'
import type { Corpus, CorpusSyncResult, CruxDocument, IndexResult } from '../src/indexing'
import { inMemoryRecordStore, inMemoryVectorStore, type ExactFilter } from '../src/storage'
import * as retrieval from '../src/retrieval'
import {
  compressToBudget,
  expandParents,
  fanout,
  judgeReranker,
  knowledgeBase,
  rerank,
  retrievalRecipe,
  retrievalStep,
  retrieve,
  rewriteQuery,
} from '../src/retrieval'
import type {
  Grounding,
  KnowledgeBase,
  KnowledgeBaseRecipeConfig,
  RecipeTrace,
  RetrievalModel,
  RetrievalRecipe,
  RetrievalRecipeSource,
  RetrievalSourceTrace,
  RetrievalStep,
  RetrievalToolDef,
  RetrievalToolPayload,
  RetrieveRequest,
  Retriever,
  RetrieverHit,
  RetrieverTools,
} from '../src/retrieval'

declare const corpus: Corpus
declare const embeddings: DenseEmbedding
declare const model: RetrievalModel

const docs = knowledgeBase({
  id: 'docs',
  corpus,
})

expectTypeOf(docs).toEqualTypeOf<KnowledgeBase>()
expectTypeOf(docs.id).toEqualTypeOf<string>()
expectTypeOf(docs.retriever()).toEqualTypeOf<Retriever<ExactFilter, 'text'>>()
expectTypeOf(docs.recipe()).toEqualTypeOf<RetrievalRecipe>()
expectTypeOf(docs.grounding()).toEqualTypeOf<Grounding>()
expectTypeOf(docs.tools()).toEqualTypeOf<RetrieverTools>()
expectTypeOf(docs.scope({ namespace: 'tenant-a' })).toMatchTypeOf<Omit<KnowledgeBase, 'scope'>>()
expectTypeOf(docs.inspect()).toMatchTypeOf<{
  id: string
  namespace: string
  lifecycle: { status: 'ready'; indexedSources: number; indexedChunks: number }
  source: { kind: 'corpus' | 'direct' }
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

const documentInput = [
  {
    namespace: 'configured-docs',
    sourceId: 'guide.md',
    content: 'Guide body',
  },
] satisfies CruxDocument[]
expectTypeOf(configuredDocs.index(documentInput)).resolves.toMatchTypeOf<IndexResult | CorpusSyncResult>()
expectTypeOf(configuredDocs.reindex(documentInput)).resolves.toMatchTypeOf<IndexResult | CorpusSyncResult>()
expectTypeOf(configuredDocs.remove('guide.md')).resolves.toEqualTypeOf<{
  sourceId: string
  deletedCount: number
}>()

expectTypeOf(configuredRetriever).toEqualTypeOf<
  Retriever<
    { readonly section?: 'guide' | 'reference' | 'api'; readonly public?: boolean; readonly rank?: number },
    EmbeddingModality
  >
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
      source: { id: 'guide.md' },
      chunkId: 'chunk-1',
      content: query,
      metadata: {},
      score: 1,
      provenance: { rawScore: 1 },
    },
  ],
})

expectTypeOf(custom.retrieve('refund policy')).resolves.toEqualTypeOf<RetrieverHit[]>()
declare const attributedHit: RetrieverHit
if (attributedHit.kind !== 'finding') {
  expectTypeOf(attributedHit.source.id).toEqualTypeOf<string>()
}
// @ts-expect-error flat source identity was replaced by structured attribution.
attributedHit.sourceId
// @ts-expect-error source attribution is immutable.
attributedHit.source = { id: 'other' }

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
const betaRerankEngine = judgeReranker({ model, name: 'beta-judge' })
expectTypeOf(rerank({ engine: betaRerankEngine, topK: 8 })).toEqualTypeOf<RetrievalStep<'hits', 'hits'>>()
expectTypeOf(expandParents()).toEqualTypeOf<RetrievalStep<'hits', 'hits'>>()
expectTypeOf(compressToBudget({ tokens: 3_500, model })).toEqualTypeOf<RetrievalStep<'hits', 'hits'>>()

const recipe = retrievalRecipe({
  id: 'docs-hybrid-cited-answer',
  retriever: configuredRetriever,
  model,
  steps: [rewriteQuery(), fanout({ maxQueries: 4 }), retrieve({ limit: 20 }), rerank({ engine: betaRerankEngine, topK: 8 }), customHitStep],
})

expectTypeOf(recipe).toEqualTypeOf<RetrievalRecipe>()
expectTypeOf(recipe.asRetriever()).toMatchTypeOf<Retriever<ExactFilter, EmbeddingModality>>()
expectTypeOf(
  configuredDocs.recipe({
    id: 'configured-docs-recipe',
    steps: [retrieve({ limit: 12 }), customHitStep],
  }),
).toEqualTypeOf<RetrievalRecipe>()
expectTypeOf(
  {
    id: 'configured-docs-recipe',
    steps: [retrieve({ limit: 12 }), customHitStep],
  } satisfies KnowledgeBaseRecipeConfig,
).toMatchTypeOf<{ id: string }>()
expectTypeOf(recipe.retrieveWithTrace('refunds')).resolves.toEqualTypeOf<{
  hits: RetrieverHit[]
  trace: RecipeTrace
}>()

const federatedRecipe = retrievalRecipe({
  id: 'federated-docs-answer',
  retriever: [configuredRetriever, custom],
  onSourceError: 'skip-with-warning',
  steps: [retrieve({ limit: 20 }), customHitStep],
})

expectTypeOf(federatedRecipe).toEqualTypeOf<RetrievalRecipe>()

const weightedFederatedRecipe = retrievalRecipe({
  id: 'weighted-federated-docs-answer',
  retriever: [
    { retriever: configuredRetriever, weight: 2 },
    { retriever: custom, weight: 0.5 },
  ],
  steps: [retrieve({ limit: 20 })],
})

expectTypeOf(weightedFederatedRecipe.retrieve('refunds')).resolves.toEqualTypeOf<RetrieverHit[]>()
expectTypeOf({ retriever: configuredRetriever, weight: 2 } satisfies RetrievalRecipeSource).toMatchTypeOf<{
  retriever: Retriever<ExactFilter, EmbeddingModality>
  weight?: number
}>()
expectTypeOf<RetrievalSourceTrace>().toMatchTypeOf<{
  retrieverId: string
  namespace: string
  status: 'success' | 'error' | 'skipped'
  queryCount: number
}>()

// @ts-expect-error federated source entries must include a retriever.
retrievalRecipe({ id: 'bad-federated-source', retriever: [{ weight: 2 }], steps: [retrieve()] })
// @ts-expect-error source failure policy is intentionally narrow.
retrievalRecipe({ id: 'bad-source-policy', retriever: [configuredRetriever, custom], onSourceError: 'ignore', steps: [retrieve()] })

const defaultTools = recipe.asTools()
expectTypeOf(defaultTools).toMatchTypeOf<{
  search: RetrievalToolDef
}>()
expectTypeOf<Awaited<ReturnType<typeof defaultTools.search.execute>>>().toEqualTypeOf<RetrievalToolPayload>()
expectTypeOf(defaultTools).not.toHaveProperty('getSource')

const prefixedTools = recipe.asTools({
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

expectTypeOf<RetrieverTools<{ prefix: true; include: readonly ['search'] }>>().toMatchTypeOf<
  Record<string, RetrievalToolDef>
>()

type AnthropicSearchResultCitation = {
  cited_text: string
  source: string
  title?: string
  start_char_index?: number
  end_char_index?: number
}

type OpenAIResponseAnnotation =
  | {
      type: 'url_citation'
      url: string
      title?: string
      start_index: number
      end_index: number
    }
  | {
      type: 'file_citation'
      file_id: string
      index: number
    }

function fromAnthropicCitation(input: AnthropicSearchResultCitation) {
  return {
    sourceId: input.source,
    chunkId: 'search-result-0',
    quote: input.cited_text,
    ...(input.source.startsWith('http') ? { url: input.source } : {}),
    ...(input.start_char_index !== undefined && input.end_char_index !== undefined
      ? { span: { start: input.start_char_index, end: input.end_char_index } }
      : {}),
    ...(input.title ? { metadata: { title: input.title } } : {}),
  } satisfies Citation
}

function fromOpenAIAnnotation(input: OpenAIResponseAnnotation) {
  if (input.type === 'url_citation') {
    return {
      sourceId: input.url,
      chunkId: 'annotation-0',
      url: input.url,
      outputSpan: { start: input.start_index, end: input.end_index },
      ...(input.title ? { metadata: { title: input.title } } : {}),
    } satisfies Citation
  }
  return {
    sourceId: input.file_id,
    chunkId: `annotation-${input.index}`,
  } satisfies Citation
}

expectTypeOf(fromAnthropicCitation).returns.toMatchTypeOf<Citation>()
expectTypeOf(fromOpenAIAnnotation).returns.toMatchTypeOf<Citation>()

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
