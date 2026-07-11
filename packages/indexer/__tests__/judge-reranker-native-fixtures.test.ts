import { rerankerDefinitionRef, retrieverDefinitionRef } from '@use-crux/core/observability'
import { describe, expect } from 'vitest'
import { extractNativeAndFallback, itWithRustOxc } from './native-first-party-fixture-helpers'

describe('judgeReranker native RAG facts', () => {
  itWithRustOxc(
    'emits the same canonical rag.reranker identity for judgeReranker as for reranker',
    async () => {
      // Real `@use-crux/*` imports so the callee is unambiguous, matching the
      // Phase 7 composition native fixture convention. `judgeReranker` is
      // core's shared LLM-judge reranker factory: it must project the exact
      // same `rag.reranker` definition shape as the `reranker` primitive so a
      // `rerank({ engine })` recipe step and the runtime's
      // `rag.reranker:<safeId(engine.name)>` join both resolve.
      const source = [
        "import { judgeReranker, rerank, retrievalRecipe, retrieve, retriever } from '@use-crux/core/retrieval'",
        '',
        "export const docsRetriever = retriever({ id: 'docs', namespace: 'public' })",
        "export const judgeRanker = judgeReranker({ name: 'Docs Judge!', model })",
        'export const docsRag = retrievalRecipe({',
        "  id: 'docsRag',",
        '  retriever: docsRetriever,',
        '  steps: [retrieve(), rerank({ engine: judgeRanker })],',
        '})',
      ].join('\n')
      const { nativeOut } = await extractNativeAndFallback({
        source,
        callNames: ['judgeReranker', 'rerank', 'retrievalRecipe', 'retrieve', 'retriever'],
      })

      const rerankerDefinition = nativeOut.definitions.find((definition) => definition.kind === 'rag.reranker')
      expect(rerankerDefinition).toMatchObject({
        id: rerankerDefinitionRef('Docs Judge!').id,
        kind: 'rag.reranker',
        name: 'Docs Judge!',
      })
      expect(rerankerDefinition?.id).toBe('rag.reranker:Docs-Judge')

      const retrieverDefinition = nativeOut.definitions.find((definition) => definition.kind === 'rag.retriever')
      expect(retrieverDefinition?.id).toBe(retrieverDefinitionRef('docs').id)

      expect(
        nativeOut.relations.some(
          (relation) =>
            relation.type === 'rag.recipe.step.uses_reranker' && relation.to === rerankerDefinition?.id,
        ),
      ).toBe(true)
    },
    30_000,
  )
})
