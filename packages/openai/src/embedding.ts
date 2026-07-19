import type OpenAI from 'openai'
import type { DenseEmbedding } from '@use-crux/core/embedding'
import { embedding as coreEmbedding } from '@use-crux/core/embedding'
import type { OpenAIEmbeddingConfig } from './types'

const OPENAI_EMBEDDING_DIMENSIONS: Record<string, number> = {
  'text-embedding-ada-002': 1536,
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
}

/**
 * Create a dense Crux embedding backed by the OpenAI embeddings API.
 *
 * Known OpenAI embedding models infer their default dimensions automatically.
 * For custom model IDs, pass `dimensions` explicitly.
 */
export function embedding(client: OpenAI, config: OpenAIEmbeddingConfig): DenseEmbedding {
  const dimensions = config.dimensions ?? OPENAI_EMBEDDING_DIMENSIONS[config.model]
  if (!dimensions) {
    throw new Error(
      `OpenAI embedding "${config.model}" requires an explicit dimensions value. Pass dimensions in embedding().`,
    )
  }

  return coreEmbedding({
    kind: 'dense',
    name: config.name,
    dimensions,
    maxInputTokens: config.maxInputTokens ?? 8192,
    version: embeddingVersion(config),
    batch: {
      maxSize: config.batch?.maxSize ?? 100,
      concurrency: config.batch?.concurrency ?? 1,
    },
    async embed(texts) {
      const response = await client.embeddings.create({
        model: config.model,
        input: texts,
        encoding_format: 'float',
        ...(config.dimensions !== undefined ? { dimensions: config.dimensions } : {}),
        ...(config.user ? { user: config.user } : {}),
      })

      const embeddings = [...response.data]
        .sort((left, right) => left.index - right.index)
        .map((item) => [...item.embedding])

      return {
        embeddings,
        usage: {
          inputTokens: response.usage.prompt_tokens,
          totalTokens: response.usage.total_tokens,
        },
      }
    },
  })
}

/** Build a stable identity from vector-producing OpenAI request fields. */
function embeddingVersion(config: OpenAIEmbeddingConfig): string {
  return [
    `openai:model=${JSON.stringify(config.model)}`,
    ...(config.version === undefined ? [] : [`version=${JSON.stringify(config.version)}`]),
  ].join(';')
}
