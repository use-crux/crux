import type { GoogleGenAI } from '@google/genai'
import type { DenseEmbedding } from '@use-crux/core/embedding'
import { embedding as coreEmbedding } from '@use-crux/core/embedding'
import type { GoogleEmbeddingConfig } from './types'

/** Create a dense Crux embedding backed by `client.models.embedContent()`. */
export function embedding(client: GoogleGenAI, config: GoogleEmbeddingConfig): DenseEmbedding {
  return coreEmbedding({
    kind: 'dense',
    name: config.name,
    dimensions: config.dimensions,
    maxInputTokens: config.maxInputTokens,
    version: embeddingVersion(config),
    batch: {
      maxSize: config.batch?.maxSize ?? 100,
      concurrency: config.batch?.concurrency ?? 1,
    },
    async embed(texts) {
      const response = await client.models.embedContent({
        model: config.model,
        contents: texts,
        config: {
          taskType: config.taskType,
          title: config.title,
          outputDimensionality: config.dimensions,
          mimeType: config.mimeType,
          autoTruncate: config.autoTruncate,
        },
      })

      const embeddings = (response.embeddings ?? []).map((embedding) => [...(embedding.values ?? [])])
      const inputTokens = (response.embeddings ?? []).reduce(
        (sum, embedding) => sum + (embedding.statistics?.tokenCount ?? 0),
        0,
      )

      return {
        embeddings,
        usage: inputTokens > 0 ? { inputTokens, totalTokens: inputTokens } : undefined,
      }
    },
  })
}

/** Build a stable identity from vector-producing Google request fields. */
function embeddingVersion(config: GoogleEmbeddingConfig): string {
  return [
    `google:model=${JSON.stringify(config.model)}`,
    `taskType=${optionalIdentityValue(config.taskType)}`,
    `title=${optionalIdentityValue(config.title)}`,
    `mimeType=${optionalIdentityValue(config.mimeType)}`,
    `autoTruncate=${optionalIdentityValue(config.autoTruncate)}`,
    ...(config.version === undefined ? [] : [`version=${JSON.stringify(config.version)}`]),
  ].join(';')
}

/** Encode an optional identity field without conflating omission with a value. */
function optionalIdentityValue(value: string | boolean | undefined): string {
  return value === undefined ? 'default' : JSON.stringify(value)
}
