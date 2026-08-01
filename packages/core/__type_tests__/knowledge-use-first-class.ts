import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { context, prompt, summarizable, droppable, offloadable, prefer } from '../src'
import type { DroppableLadder, PreferLadder, SummarizableLadder } from '../src'
import { assertions, knowledgeBase } from '../src/knowledge'
import { retriever, retrievalRecipe, retrieve } from '../src/retrieval'
import { inMemoryStorage } from '../src/storage'

const docs = knowledgeBase({
  id: 'docs',
  storage: inMemoryStorage(),
  metadataSchema: z.object({ status: z.enum(['open', 'closed']) }),
})
const view = docs.view({ id: 'open', where: { status: 'open' } })
const recipe = docs.recipe({ steps: [retrieve()] })
const compact = context({ id: 'compact', system: 'Compact docs.' })
const facts = assertions({
  id: 'facts',
  version: 1,
  types: { fact: z.object({ id: z.string() }) },
  run: () => undefined,
})

prompt({
  use: [docs, view, recipe, docs.assertions(facts), docs.assertions(facts).resolve()],
  prompt: 'Answer.',
})

expectTypeOf(summarizable(docs)).toMatchTypeOf<SummarizableLadder>()
expectTypeOf(summarizable(view)).toMatchTypeOf<SummarizableLadder>()
expectTypeOf(summarizable(recipe)).toMatchTypeOf<SummarizableLadder>()
expectTypeOf(droppable(offloadable(recipe))).toMatchTypeOf<DroppableLadder>()
expectTypeOf(droppable(offloadable(docs))).toMatchTypeOf<DroppableLadder>()
expectTypeOf(prefer(view, compact)).toMatchTypeOf<PreferLadder>()
expectTypeOf(docs.retriever().asContext({ tools: true })).toMatchTypeOf<ReturnType<typeof docs.asContext>>()

const standaloneRetriever = retriever({
  id: 'standalone',
  namespace: 'standalone',
  retrieve: async () => [],
})
const standaloneRecipe = retrievalRecipe({
  id: 'standalone-recipe',
  retriever: standaloneRetriever,
  steps: [retrieve()],
})

prompt({
  use: [standaloneRecipe],
  prompt: 'Answer.',
})
