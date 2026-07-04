/**
 * Public type contract for Retrieval/RAG reranking beta helpers.
 */

import { expectTypeOf } from 'vitest'
import { rerank, judgeReranker } from '../retrieval'
import type { Reranker, RetrievalModel, RetrievalStep, RetrieverHit } from '../retrieval'

declare const model: RetrievalModel
declare const hits: readonly RetrieverHit[]

const engine = {
  name: 'custom-reranker',
  rerank: async ({ query, hits }: { query: string; hits: readonly RetrieverHit[] }) => [...hits],
} satisfies Reranker

expectTypeOf(engine.rerank({ query: 'refunds', hits })).resolves.toEqualTypeOf<RetrieverHit[]>()
expectTypeOf(judgeReranker({ model })).toEqualTypeOf<Reranker>()
expectTypeOf(judgeReranker({ model, name: 'judge', topN: 5, document: (hit) => hit.content })).toEqualTypeOf<Reranker>()
expectTypeOf(rerank({ engine, topK: 4 })).toEqualTypeOf<RetrievalStep<'hits', 'hits'>>()
expectTypeOf(rerank({ topK: 4, model })).toEqualTypeOf<RetrievalStep<'hits', 'hits'>>()
