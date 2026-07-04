/**
 * Compile-time checks for Anthropic retrieval capability factories.
 */

import { expectTypeOf, it } from 'vitest'
import type { Reranker, RetrievalModel } from '@use-crux/core/retrieval'
import { createAnthropic } from '../index'

type AnthropicAdapter = ReturnType<typeof createAnthropic>

expectTypeOf<ReturnType<AnthropicAdapter['retrievalModel']>>().toEqualTypeOf<RetrievalModel>()
expectTypeOf<ReturnType<AnthropicAdapter['reranker']>>().toEqualTypeOf<Reranker>()

it('exposes retrieval capability factory contracts', () => {
  expectTypeOf<AnthropicAdapter>().toMatchTypeOf<AnthropicAdapter>()
})
