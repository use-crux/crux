/**
 * Public type contract for Retrieval/RAG reranking beta helpers.
 */

import { expectTypeOf } from 'vitest'
import { rerank, judgeReranker } from '../src/retrieval'
import type { Reranker, RetrievalModel, RetrievalStep, RetrieverHit } from '../src/retrieval'

declare const model: RetrievalModel
declare const hits: readonly RetrieverHit[]

const engine = {
  name: 'custom-reranker',
  rerank: async ({ query, hits }: { query: string; hits: readonly RetrieverHit[] }) => [...hits],
} satisfies Reranker

expectTypeOf(engine.rerank({ query: 'refunds', hits })).resolves.toEqualTypeOf<RetrieverHit[]>()
// `name` is a required, authored reranker identity.
expectTypeOf(judgeReranker({ model, name: 'judge' })).toEqualTypeOf<Reranker>()
expectTypeOf(judgeReranker({ model, name: 'judge', topN: 5, document: (hit) => hit.content })).toEqualTypeOf<Reranker>()
// `rerank()` requires an explicit named engine — no anonymous default-model path.
expectTypeOf(rerank({ engine, topK: 4 })).toEqualTypeOf<RetrievalStep<'hits', 'hits'>>()
expectTypeOf(rerank({ engine, id: 'primary', topK: 4 })).toEqualTypeOf<RetrievalStep<'hits', 'hits'>>()
