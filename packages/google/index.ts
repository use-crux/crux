/**
 * `@crux/google` — Google GenAI SDK adapter.
 *
 * Built on `adapter()` from `@crux/core/adapter`. Provides `createGoogle()`
 * factory that returns a `CruxAdapter` with `generate()`, `stream()`, plus
 * agent composition methods (parallel, pipeline, consensus, swarm).
 *
 * Supports Google's CachedContent API for provider-level caching. When
 * `systemBlocks` contain blocks with `providerCache: true`, the adapter
 * automatically creates/reuses server-side cache objects.
 *
 * @example
 * ```ts
 * import { prompt } from '@crux/core'
 * import { createGoogle } from '@crux/google'
 * import { GoogleGenAI } from '@google/genai'
 *
 * const google = createGoogle(new GoogleGenAI({ apiKey: '...' }))
 *
 * const result = await google.generate(myPrompt, {
 *   model: 'gemini-2.5-flash',
 *   input: { instruction: 'Fix typos' },
 * })
 * ```
 *
 * @module
 */

import type { GoogleGenAI, GenerateContentResponse } from '@google/genai'
import { z } from 'zod'
import type { GenerationSettings } from '@crux/core'
import type { GenerateObjectFn, GenerateTextFn } from '@crux/core/compaction'
import type { DenseEmbedding } from '@crux/core/embedding'
import { embedding as coreEmbedding } from '@crux/core/embedding'
import { adapter } from '@crux/core/adapter'
import type { AdapterSpec, CallArgs, AdapterResponse, StreamHandle, ToolResultEntry } from '@crux/core/adapter'
import { GoogleCacheManager } from './cache-manager'
import type { GoogleCacheConfig } from './cache-types'
import { resolveCacheConfig } from './cache-types'
import { messagesToGoogleContents } from './message-codec'
import { resolveGoogleSystemConfig } from './system-cache-planner'

// Re-export cache types for consumers
export type { GoogleCacheConfig } from './cache-types'
export { fromMessages, toMessages } from './message-codec'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** Google GenAI function declaration for tool use. */
export interface GoogleFunctionDeclaration {
  name: string
  description: string
  parameters?: {
    type: string
    properties: Record<string, unknown>
    required?: string[]
  }
}

/** Provider-specific extra options for Google adapter. */
export interface GoogleExtra extends Record<string, unknown> {
  /** Function declarations for tool use (bypass Crux tool conversion). */
  tools?: GoogleFunctionDeclaration[]
  /**
   * Per-call CachedContent controls.
   *
   * These options affect only the current request. `skip` falls back to a
   * plain `systemInstruction`, while `ttlSeconds` overrides the adapter-level
   * default TTL for a newly-created cache and participates in local cache
   * reuse keys.
   */
  cache?: {
    /** Force skip caching for this call. */
    skip?: boolean
    /** TTL in seconds for this call's Google CachedContent object. */
    ttlSeconds?: number
  }
}

export interface GoogleEmbeddingConfig {
  name: string
  model: string
  dimensions: number
  maxInputTokens: number
  batch?: {
    maxSize?: number
    concurrency?: number
  }
  taskType?: string
  title?: string
  mimeType?: string
  autoTruncate?: boolean
}

// ─────────────────────────────────────────────────────────────────
// AdapterSpec
// ─────────────────────────────────────────────────────────────────

/** Build tools config shared between call() and stream(). */
function buildToolsConfig(args: CallArgs<GoogleExtra>): Record<string, unknown> | undefined {
  if (args.extra?.tools && args.extra.tools.length > 0) {
    return { tools: [{ functionDeclarations: args.extra.tools }] }
  }
  if (args.tools && args.tools.length > 0) {
    return {
      tools: [
        {
          functionDeclarations: args.tools.map((t) => ({
            name: t.name,
            description: t.description,
            ...(Object.keys(t.parameters).length > 0 ? { parameters: t.parameters } : {}),
          })),
        },
      ],
    }
  }
  return undefined
}

/** Build the native Google `AdapterSpec`, closing over an optional cache manager. */
export function buildGoogleSpec(
  cacheManager?: GoogleCacheManager,
): AdapterSpec<GoogleGenAI, GenerateContentResponse, AsyncIterable<GenerateContentResponse>, GoogleExtra> {
  return {
    providerId: 'google',

    async call(client, args: CallArgs<GoogleExtra>) {
      // `GenerateContentConfig` is a wide structural shape; Crux merges in
      // open `args.settings` plus tools, cache, and schema params, which
      // doesn't structurally satisfy any concrete generic.
      const config: Record<string, unknown> = {
        ...args.settings,
      }

      // Resolve system instruction with optional caching
      const systemConfig = await resolveGoogleSystemConfig({
        cacheResolver: cacheManager,
        model: args.model,
        system: args.system,
        systemBlocks: args.systemBlocks,
        cache: args.extra?.cache,
      })
      if (systemConfig.cachedContent) config.cachedContent = systemConfig.cachedContent
      if (systemConfig.systemInstruction) config.systemInstruction = systemConfig.systemInstruction

      // Tools
      const toolsConfig = buildToolsConfig(args)
      if (toolsConfig) Object.assign(config, toolsConfig)

      // Structured output via JSON schema
      if (args.schemaParams) {
        Object.assign(config, args.schemaParams)
      }

      const contents = messagesToGoogleContents(args.messages)
      const response = await client.models.generateContent({
        model: args.model,
        contents,
        config: config as Parameters<typeof client.models.generateContent>[0]['config'],
      })

      // Extract canonical response. Google's `Part` is a discriminated union —
      // pull out the function-call variant for tool-call extraction. `FunctionCall`
      // fields (`name`, `args`) are optional in the SDK, so coerce when emitting.
      const candidate = response.candidates?.[0]
      const functionCalls = (candidate?.content?.parts ?? []).flatMap((p) => {
        const fc = (p as { functionCall?: { name?: string; args?: Record<string, unknown> } }).functionCall
        return fc ? [fc] : []
      })

      const extracted: AdapterResponse = {
        text: response.text ?? '',
        toolCalls:
          functionCalls.length > 0
            ? functionCalls.map((fc, i) => ({
                id: `tc_${i}`,
                name: fc.name ?? '',
                args: fc.args,
              }))
            : undefined,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
          cacheReadTokens: response.usageMetadata?.cachedContentTokenCount,
        },
        finishReason: candidate?.finishReason?.toLowerCase(),
        responseId: undefined,
        actualModelId: response.modelVersion,
      }

      return { raw: response, extracted }
    },

    async stream(client, args: CallArgs<GoogleExtra>) {
      const config: Record<string, unknown> = {
        ...args.settings,
      }

      // Resolve system instruction with optional caching
      const systemConfig = await resolveGoogleSystemConfig({
        cacheResolver: cacheManager,
        model: args.model,
        system: args.system,
        systemBlocks: args.systemBlocks,
        cache: args.extra?.cache,
      })
      if (systemConfig.cachedContent) config.cachedContent = systemConfig.cachedContent
      if (systemConfig.systemInstruction) config.systemInstruction = systemConfig.systemInstruction

      // Tools
      const toolsConfig = buildToolsConfig(args)
      if (toolsConfig) Object.assign(config, toolsConfig)

      if (args.schemaParams) {
        Object.assign(config, args.schemaParams)
      }

      const contents = messagesToGoogleContents(args.messages)
      const rawStream = await client.models.generateContentStream({
        model: args.model,
        contents,
        config: config as Parameters<typeof client.models.generateContentStream>[0]['config'],
      })

      return {
        rawStream,
        extractTextDelta: (chunk: unknown) => {
          const c = chunk as
            | { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
            | null
            | undefined
          return c?.candidates?.[0]?.content?.parts?.[0]?.text
        },
        completion: async () => undefined,
      } as StreamHandle<AsyncIterable<GenerateContentResponse>>
    },

    appendToolRound(messages, assistantResponse, toolResults) {
      return [
        ...messages,
        // Assistant message with tool calls
        {
          role: 'assistant' as const,
          content: assistantResponse.text,
          metadata: { toolCalls: assistantResponse.toolCalls },
        },
        // Google uses functionResponse parts in a user role message
        ...toolResults.map((tr) => ({
          role: 'tool' as const,
          content: tr.content,
          metadata: { toolCallId: tr.toolCallId, toolName: tr.name, modelOutput: tr.modelOutput },
        })),
      ]
    },

    mapSettings(settings: GenerationSettings): Record<string, unknown> {
      const config: Record<string, unknown> = {}
      if (settings.temperature !== undefined) config.temperature = settings.temperature
      if (settings.maxTokens !== undefined) config.maxOutputTokens = settings.maxTokens
      if (settings.topP !== undefined) config.topP = settings.topP
      if (settings.topK !== undefined) config.topK = settings.topK
      if (settings.stopSequences !== undefined) config.stopSequences = settings.stopSequences

      // Pass through any Google-native settings
      const knownKeys = new Set([
        'temperature',
        'maxTokens',
        'topP',
        'topK',
        'stopSequences',
        'frequencyPenalty',
        'presencePenalty',
      ])
      for (const [key, value] of Object.entries(settings)) {
        if (value !== undefined && !knownKeys.has(key) && !(key in config)) {
          config[key] = value
        }
      }

      return config
    },

    wrapOutputSchema(schema: z.ZodType): Record<string, unknown> {
      const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>
      return {
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema,
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// createGoogle()
// ─────────────────────────────────────────────────────────────────

/** Options for `createGoogle()`. */
export interface CreateGoogleOptions {
  /**
   * Cache configuration for Google's CachedContent API.
   *
   * - `undefined` / omitted: caching enabled with defaults (activates only
   *   when `systemBlocks` with `providerCache: true` are present)
   * - `GoogleCacheConfig`: custom TTL, max entries, etc.
   * - `false`: disable cache management entirely
   */
  cache?: GoogleCacheConfig | false
}

/**
 * Create a Google GenAI adapter bound to a client instance.
 *
 * Returns a `CruxAdapter` with `generate()`, `stream()`, and agent
 * composition methods (parallel, pipeline, consensus, swarm).
 *
 * Supports Google's CachedContent API for provider-level caching. Caching
 * activates automatically when the leading `systemBlocks` have
 * `providerCache: true`; the cached prefix is sent via `cachedContent` and the
 * uncached remainder stays in `systemInstruction`. Disable cache lifecycle
 * management with `{ cache: false }`.
 *
 * @example
 * ```ts
 * const google = createGoogle(new GoogleGenAI({ apiKey: '...' }))
 * const result = await google.generate(myPrompt, { model: 'gemini-2.5-flash', input: { ... } })
 * result.text   // extracted text
 * result.raw    // raw GenerateContentResponse
 * result._meta  // normalized usage, finish reason, etc.
 * ```
 *
 * @example Cache configuration
 * ```ts
 * const google = createGoogle(client, { cache: { defaultTtlSeconds: 600 } })
 * ```
 */
export function createGoogle(client: GoogleGenAI, opts?: CreateGoogleOptions) {
  const cacheManager =
    opts?.cache !== false ? new GoogleCacheManager(client, resolveCacheConfig(opts?.cache)) : undefined

  const spec = buildGoogleSpec(cacheManager)
  return adapter(spec)(client)
}

/**
 * Create a dense Crux embedding backed by `client.models.embedContent()`.
 */
export function embedding(client: GoogleGenAI, config: GoogleEmbeddingConfig): DenseEmbedding {
  return coreEmbedding({
    kind: 'dense',
    name: config.name,
    dimensions: config.dimensions,
    maxInputTokens: config.maxInputTokens,
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

// ─────────────────────────────────────────────────────────────────
// Framework-agnostic adapters
// ─────────────────────────────────────────────────────────────────

/**
 * Create a `GenerateObjectFn` that wraps a Google GenAI client.
 *
 * Use this when calling `@crux/core` APIs that expect a `GenerateObjectFn`
 * (e.g., `llmJudge().score()`, `extractKeyFacts()`).
 *
 * This is a provider-native helper: it sends the supplied schema to Google
 * GenAI structured JSON output, parses the response through the schema, and
 * preserves provider errors. It does not run Crux prompt resolution,
 * validation retry, safety, cassettes, tools, memory, or instrumentation. Use
 * `createGenerateObjectFnFromGenerate(generate)` from `@crux/core/compaction`
 * when the helper call must go through full adapter prompt execution.
 *
 * @example
 * ```ts
 * import { createGenerateObjectFn } from '@crux/google'
 * import { GoogleGenAI } from '@google/genai'
 *
 * const client = new GoogleGenAI({ apiKey: '...' })
 * const generateObjectFn = createGenerateObjectFn(client, 'gemini-2.5-flash')
 * const result = await judge.score(input, { generate: generateObjectFn })
 * ```
 */
export function createGenerateObjectFn(client: GoogleGenAI, model: string): GenerateObjectFn {
  return async (options) => {
    const jsonSchema = z.toJSONSchema(options.schema) as Record<string, unknown>
    const response = await client.models.generateContent({
      model,
      contents: options.prompt,
      config: {
        ...(options.system ? { systemInstruction: options.system } : {}),
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema,
      },
    })
    const object = options.schema.parse(JSON.parse(response.text ?? ''))
    return { object }
  }
}

/**
 * Create a `GenerateTextFn` that wraps a Google GenAI client.
 *
 * @example
 * ```ts
 * import { createGenerateTextFn } from '@crux/google'
 * const generateTextFn = createGenerateTextFn(client, 'gemini-2.5-flash')
 * await compactConversation({ generate: generateTextFn, ... })
 * ```
 */
export function createGenerateTextFn(client: GoogleGenAI, model: string): GenerateTextFn {
  return async (options) => {
    const response = await client.models.generateContent({
      model,
      contents: options.prompt,
      config: {
        ...(options.system ? { systemInstruction: options.system } : {}),
      },
    })
    return { text: response.text ?? '' }
  }
}
