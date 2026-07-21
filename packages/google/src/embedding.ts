import type { Content, EmbedContentConfig, EmbedContentResponse, GoogleGenAI } from '@google/genai'
import type {
  DenseEmbedding,
  EmbeddingModality,
  EmbeddingModalityError,
} from '@use-crux/core/embedding'
import { embedding as coreEmbedding } from '@use-crux/core/embedding'
import { googleEmbeddingContent } from './embedding-content'
import {
  googleEmbeddingModalities,
  type GoogleDefaultEmbeddingModality,
} from './embedding-models'
import type { GoogleEmbeddingConfig } from './types'

type ResolvedGoogleEmbeddingModality<
  TModel extends string,
  TModalities extends readonly EmbeddingModality[] | undefined,
> = TModalities extends readonly EmbeddingModality[]
  ? TModalities[number]
  : GoogleDefaultEmbeddingModality<TModel>

type GoogleEmbeddingIdentityConfig = {
  readonly model: string
  readonly tasks?: { readonly query?: string; readonly document?: string }
  readonly title?: string
  readonly mimeType?: string
  readonly autoTruncate?: boolean
  readonly version?: string
}

/**
 * Create a dense Crux embedding backed by `client.models.embedContent()`.
 *
 * Known literal model ids infer their verified modalities. Explicit
 * `modalities` override that default and remain const-narrowed.
 *
 * @param client - Configured Google GenAI client.
 * @param config - Model, sizing, modality, role-task, and batch configuration.
 * @returns A dense embedding whose input type follows the resolved modalities.
 * @throws {@link EmbeddingModalityError} before Google I/O for undeclared media.
 *
 * @example
 * ```ts
 * const embed = embedding(client, { model: 'gemini-embedding-2' })
 * await embed.embed('dog', { role: 'query' })
 * await embed.embed({ type: 'image', source: dogPhoto })
 * ```
 */
export function embedding<
  const TModel extends string,
  const TModalities extends readonly EmbeddingModality[] | undefined = undefined,
>(
  client: GoogleGenAI,
  config: GoogleEmbeddingConfig<TModel, TModalities>,
): DenseEmbedding<ResolvedGoogleEmbeddingModality<TModel, TModalities>> {
  const modalities = googleEmbeddingModalities(config.model, config.modalities)
  const { name, dimensions, maxInputTokens } = resolveGoogleEmbeddingSizing(config)
  const result = coreEmbedding({
    kind: 'dense',
    name,
    dimensions,
    maxInputTokens,
    modalities,
    tasks: config.tasks,
    version: embeddingVersion(config),
    batch: {
      maxSize: config.batch?.maxSize ?? 100,
      concurrency: config.batch?.concurrency ?? 1,
    },
    async embed(inputs, context) {
      const responses = await embedGoogleContents({
        client,
        model: config.model,
        contents: inputs.map(googleEmbeddingContent),
        config: {
          taskType: config.tasks?.[context.role],
          title: config.title,
          outputDimensionality: dimensions,
          mimeType: config.mimeType,
          autoTruncate: config.autoTruncate,
        },
      })
      const providerEmbeddings = responses.flatMap((response) => response.embeddings ?? [])
      const embeddings = providerEmbeddings.map((embedding) => [...(embedding.values ?? [])])
      const inputTokens = providerEmbeddings.reduce(
        (sum, embedding) => sum + (embedding.statistics?.tokenCount ?? 0),
        0,
      )

      return {
        embeddings,
        usage: inputTokens > 0 ? { inputTokens, totalTokens: inputTokens } : undefined,
      }
    },
  })
  return result as unknown as DenseEmbedding<ResolvedGoogleEmbeddingModality<TModel, TModalities>>
}

function resolveGoogleEmbeddingSizing(config: {
  readonly model: string
  readonly name?: string
  readonly dimensions?: number
  readonly maxInputTokens?: number
}): { name: string; dimensions: number; maxInputTokens: number } {
  const name = config.name ?? config.model
  if (config.model === 'gemini-embedding-2') {
    return {
      name,
      dimensions: config.dimensions ?? 3072,
      maxInputTokens: config.maxInputTokens ?? 8192,
    }
  }
  if (config.dimensions === undefined || config.maxInputTokens === undefined) {
    throw new TypeError(
      `Google embedding "${config.model}" requires explicit dimensions and maxInputTokens.`,
    )
  }
  return { name, dimensions: config.dimensions, maxInputTokens: config.maxInputTokens }
}

async function embedGoogleContents(args: {
  readonly client: GoogleGenAI
  readonly model: string
  readonly contents: readonly Content[]
  readonly config: EmbedContentConfig
}): Promise<EmbedContentResponse[]> {
  if (args.client.vertexai && args.model.includes('gemini-embedding-2') && args.contents.length > 1) {
    const responses: EmbedContentResponse[] = []
    for (const content of args.contents) {
      responses.push(await sendGoogleEmbeddingRequest(args, [content]))
    }
    return responses
  }
  return [await sendGoogleEmbeddingRequest(args, args.contents)]
}

function sendGoogleEmbeddingRequest(
  args: Parameters<typeof embedGoogleContents>[0],
  contents: readonly Content[],
): Promise<EmbedContentResponse> {
  return args.client.models.embedContent({
    model: args.model,
    contents: [...contents],
    config: args.config,
  })
}

/** Build a stable identity from vector-producing Google request fields. */
function embeddingVersion(config: GoogleEmbeddingIdentityConfig): string {
  return [
    `google:model=${JSON.stringify(config.model)}`,
    `tasks.query=${optionalIdentityValue(config.tasks?.query)}`,
    `tasks.document=${optionalIdentityValue(config.tasks?.document)}`,
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
