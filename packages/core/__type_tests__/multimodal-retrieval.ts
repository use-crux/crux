import { embedding } from '../src/embedding'
import { indexer } from '../src/indexing'
import { knowledgeBase, retriever, retrievalRecipe, retrieve } from '../src/retrieval'
import { inMemoryStorage } from '../src/storage'

const storage = inMemoryStorage()
const image = {
  type: 'data' as const,
  data: new Uint8Array([1]),
  mediaType: 'image/png',
}
const dense = embedding({
  kind: 'dense', name: 'multimodal', dimensions: 2, maxInputTokens: 100,
  modalities: ['text', 'image'], batch: { maxSize: 8 },
  embed: async (inputs) => inputs.map(() => [1, 0]),
})
const images = retriever({ id: 'images', namespace: 'images', storage, dense })
indexer({ id: 'images', namespace: 'images', storage, dense })
const recipe = retrievalRecipe({ id: 'image-recipe', retriever: images, steps: [retrieve()] })

images.retrieve(image)
images.retrieve({ input: image, limit: 2 })
recipe.retrieve(image)
knowledgeBase({ id: 'image-kb', storage, embeddings: dense }).retriever().retrieve(image)

const textOnly = embedding({
  kind: 'dense', name: 'text-only', dimensions: 2, maxInputTokens: 100,
  batch: { maxSize: 8 }, embed: async (inputs) => inputs.map(() => [1, 0]),
})
const textOnlyRetriever = retriever({ id: 'text', namespace: 'text', storage, dense: textOnly })

// @ts-expect-error bare media assets are rejected by a statically text-only retriever
textOnlyRetriever.retrieve(image)
// @ts-expect-error typed media is rejected by a statically text-only retriever
textOnlyRetriever.retrieve({ type: 'image', source: image })
// @ts-expect-error knowledge-base retrievers preserve their embedding modality
knowledgeBase({ id: 'text-kb', storage, embeddings: textOnly }).retriever().retrieve(image)

// @ts-expect-error custom retrievers are text-only even with an explicit modality argument
retriever<'image'>({ id: 'invalid-custom', namespace: 'text', retrieve: async () => [] })

// @ts-expect-error structured requests must contain query or input, not both
images.retrieve({ query: 'dog', input: image })
// @ts-expect-error unknown request members are not embedding inputs
images.retrieve({ unknown: 'dog' })
