/**
 * Compile-time checks for OpenAI retrieval capability factories.
 */

import { expectTypeOf, it } from 'vitest'
import type { Reranker, RetrievalModel } from '@use-crux/core/retrieval'
import { createOpenAI } from '../src'

type OpenAIAdapter = ReturnType<typeof createOpenAI>

expectTypeOf<ReturnType<OpenAIAdapter['retrievalModel']>>().toEqualTypeOf<RetrievalModel>()
expectTypeOf<ReturnType<OpenAIAdapter['reranker']>>().toEqualTypeOf<Reranker>()

it('exposes retrieval capability factory contracts', () => {
  expectTypeOf<OpenAIAdapter>().toMatchTypeOf<OpenAIAdapter>()
})
