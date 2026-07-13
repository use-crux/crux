import { z } from 'zod'
import { embedding } from '@use-crux/core/embedding'
import {
  knowledgeBase,
  retrievalRecipe,
  retrieve,
  retriever,
  type KnowledgeBase,
  type RetrievalRecipe,
  type Retriever,
} from '../src/retrieval'

const dense = embedding({
  kind: 'dense',
  name: 'convex-retrieval-dense',
  dimensions: 2,
  maxInputTokens: 100,
  batch: { maxSize: 8 },
  embed: async (texts) => texts.map(() => [1, 0]),
})

const metadataSchema = z.object({
  tenantId: z.string(),
})

const docs = knowledgeBase({
  id: 'docs',
  embeddings: dense,
  metadataSchema,
})

const typedDocs: KnowledgeBase<typeof metadataSchema> = docs
docs.retriever({ filter: { tenantId: 'tenant-a' } })

const storeBacked = retriever({
  id: 'docs',
  namespace: 'tenant-a',
  dense,
})

const typedStoreBacked: Retriever = storeBacked

const custom = retriever({
  id: 'custom-docs',
  namespace: 'tenant-a',
  retrieve: async () => [
    {
      namespace: 'tenant-a',
      source: { id: 'guide' },
      chunkId: 'a',
      content: 'Guide',
      metadata: {},
      score: 1,
    },
  ],
})

const typedCustom: Retriever = custom

const recipe = retrievalRecipe({
  id: 'docs-recipe',
  retriever: storeBacked,
  steps: [retrieve()],
})

const typedRecipe: RetrievalRecipe = recipe

void typedDocs
void typedStoreBacked
void typedCustom
void typedRecipe
