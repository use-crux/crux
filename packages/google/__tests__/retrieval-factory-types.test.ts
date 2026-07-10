/**
 * Compile-time checks for Google retrieval capability factories.
 */

import { expectTypeOf, it } from 'vitest'
import type { Reranker, RetrievalModel } from '@use-crux/core/retrieval'
import { createGoogle } from '../src'

type GoogleAdapter = ReturnType<typeof createGoogle>

expectTypeOf<ReturnType<GoogleAdapter['retrievalModel']>>().toEqualTypeOf<RetrievalModel>()
expectTypeOf<ReturnType<GoogleAdapter['reranker']>>().toEqualTypeOf<Reranker>()

it('exposes retrieval capability factory contracts', () => {
  expectTypeOf<GoogleAdapter>().toMatchTypeOf<GoogleAdapter>()
})
