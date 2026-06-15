/**
 * `@crux/openai` — OpenAI SDK adapter.
 *
 * Built on `adapter()` from `@crux/core/adapter`. Provides `createOpenAI()`
 * factory that returns a `CruxAdapter` with `generate()`, `stream()`, plus
 * agent composition methods (parallel, pipeline, consensus, swarm).
 *
 * @example
 * ```ts
 * import { prompt } from '@crux/core'
 * import { createOpenAI } from '@crux/openai'
 * import OpenAI from 'openai'
 *
 * const openai = createOpenAI(new OpenAI({ apiKey: '...' }))
 *
 * const result = await openai.generate(myPrompt, {
 *   model: 'gpt-4o',
 *   input: { instruction: 'Fix typos' },
 * })
 * ```
 *
 * @module
 */

import type OpenAI from 'openai'
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { Stream } from 'openai/streaming'
import { zodResponseFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import type { GenerationSettings } from '@crux/core'
import type { GenerateObjectFn, GenerateTextFn } from '@crux/core/compaction'
import type { DenseEmbedding } from '@crux/core/embedding'
import { embedding as coreEmbedding } from '@crux/core/embedding'
import { adapter } from '@crux/core/adapter'
import type { AdapterSpec, CallArgs, AdapterResponse, StreamHandle, ToolResultEntry } from '@crux/core/adapter'
import { fromMessages } from './message-codec'

export { fromMessages, toMessages } from './message-codec'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** Provider-specific extra options for OpenAI adapter. */
export interface OpenAIExtra extends Record<string, unknown> {
  /** OpenAI tool definitions for function calling (bypass Crux tool conversion). */
  tools?: OpenAI.ChatCompletionTool[]
  /** Tool choice strategy. */
  tool_choice?: OpenAI.ChatCompletionToolChoiceOption
  /** Whether to allow parallel tool calls. */
  parallel_tool_calls?: boolean
}

export interface OpenAIEmbeddingConfig {
  name: string
  model: string
  dimensions?: number
  maxInputTokens?: number
  batch?: {
    maxSize?: number
    concurrency?: number
  }
  user?: string
}

const OPENAI_EMBEDDING_DIMENSIONS: Record<string, number> = {
  'text-embedding-ada-002': 1536,
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
}

// ─────────────────────────────────────────────────────────────────
// AdapterSpec
// ─────────────────────────────────────────────────────────────────

function safeParseJson(str: string): unknown {
  try {
    return JSON.parse(str)
  } catch {
    return str
  }
}

function asOpenAINonStreamingParams(params: Record<string, unknown>): OpenAI.ChatCompletionCreateParamsNonStreaming {
  return params as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming
}

function asOpenAIStreamingParams(params: Record<string, unknown>): OpenAI.ChatCompletionCreateParamsStreaming {
  return params as unknown as OpenAI.ChatCompletionCreateParamsStreaming
}

/** Native OpenAI `AdapterSpec`; exported for adapter conformance tests. */
export const openaiSpec: AdapterSpec<OpenAI, ChatCompletion, Stream<ChatCompletionChunk>, OpenAIExtra> = {
  providerId: 'openai',

  async call(client, args: CallArgs<OpenAIExtra>) {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      ...(args.system ? [{ role: 'system' as const, content: args.system }] : []),
      ...fromMessages(args.messages),
    ]

    // Tools: prefer extra.tools (raw OpenAI format), else convert canonical tools
    const toolParams: Record<string, unknown> = {}
    if (args.extra?.tools && args.extra.tools.length > 0) {
      toolParams.tools = args.extra.tools
    } else if (args.tools && args.tools.length > 0) {
      toolParams.tools = args.tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          ...(Object.keys(t.parameters).length > 0 ? { parameters: t.parameters } : {}),
        },
      }))
    }

    if (args.extra?.tool_choice) {
      toolParams.tool_choice = args.extra.tool_choice
    }
    if (args.extra?.parallel_tool_calls !== undefined) {
      toolParams.parallel_tool_calls = args.extra.parallel_tool_calls
    }

    const createBody: Record<string, unknown> = {
      model: args.model,
      messages,
      ...args.settings,
      ...toolParams,
    }
    const result: OpenAI.ChatCompletion = args.schemaParams
      ? await client.chat.completions.parse(asOpenAINonStreamingParams({ ...createBody, ...args.schemaParams }))
      : await client.chat.completions.create(asOpenAINonStreamingParams(createBody))

    // Extract canonical response
    const choice = result.choices?.[0]
    const choiceMessage = choice?.message as (OpenAI.ChatCompletionMessage & { parsed?: unknown }) | undefined
    const toolCalls = choiceMessage?.tool_calls

    const extracted: AdapterResponse = {
      text:
        choiceMessage?.parsed != null
          ? typeof choiceMessage.parsed === 'string'
            ? choiceMessage.parsed
            : JSON.stringify(choiceMessage.parsed)
          : (choiceMessage?.content ?? ''),
      toolCalls:
        toolCalls && toolCalls.length > 0
          ? toolCalls
              .filter((tc): tc is OpenAI.ChatCompletionMessageFunctionToolCall => tc.type === 'function')
              .map((tc) => ({
                id: tc.id,
                name: tc.function.name,
                args: safeParseJson(tc.function.arguments),
              }))
          : undefined,
      usage: result.usage
        ? {
            inputTokens: result.usage.prompt_tokens ?? 0,
            outputTokens: result.usage.completion_tokens ?? 0,
            totalTokens: result.usage.total_tokens ?? 0,
          }
        : { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      finishReason: choice?.finish_reason,
      responseId: result.id,
      actualModelId: result.model,
    }

    return { raw: result, extracted }
  },

  async stream(client, args: CallArgs<OpenAIExtra>) {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      ...(args.system ? [{ role: 'system' as const, content: args.system }] : []),
      ...fromMessages(args.messages),
    ]

    const toolParams: Record<string, unknown> = {}
    if (args.extra?.tools && args.extra.tools.length > 0) {
      toolParams.tools = args.extra.tools
    } else if (args.tools && args.tools.length > 0) {
      toolParams.tools = args.tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          ...(Object.keys(t.parameters).length > 0 ? { parameters: t.parameters } : {}),
        },
      }))
    }

    if (args.extra?.tool_choice) {
      toolParams.tool_choice = args.extra.tool_choice
    }

    const streamBody: Record<string, unknown> = {
      model: args.model,
      messages,
      ...args.settings,
      ...toolParams,
      stream: true,
    }
    const rawStream = await client.chat.completions.create(
      asOpenAIStreamingParams(args.schemaParams ? { ...streamBody, ...args.schemaParams } : streamBody),
    )

    return {
      rawStream,
      extractTextDelta: (chunk: unknown) => {
        const c = chunk as { choices?: Array<{ delta?: { content?: string } }> } | null | undefined
        return c?.choices?.[0]?.delta?.content
      },
      completion: async () => undefined,
    } as unknown as StreamHandle<Stream<ChatCompletionChunk>>
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
      // OpenAI uses tool role with tool_call_id for tool results
      ...toolResults.map((tr) => ({
        role: 'tool' as const,
        content: tr.content,
        metadata: { toolCallId: tr.toolCallId, toolName: tr.name, modelOutput: tr.modelOutput },
      })),
    ]
  },

  mapSettings(settings: GenerationSettings): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    if (settings.temperature !== undefined) result.temperature = settings.temperature
    if (settings.maxTokens !== undefined) result.max_tokens = settings.maxTokens
    if (settings.topP !== undefined) result.top_p = settings.topP
    if (settings.frequencyPenalty !== undefined) result.frequency_penalty = settings.frequencyPenalty
    if (settings.presencePenalty !== undefined) result.presence_penalty = settings.presencePenalty
    if (settings.stopSequences !== undefined) result.stop = settings.stopSequences

    // Pass through any OpenAI-native settings (e.g. seed, logprobs)
    const knownKeys = new Set([
      'temperature',
      'maxTokens',
      'topP',
      'topK',
      'frequencyPenalty',
      'presencePenalty',
      'stopSequences',
    ])
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined && !knownKeys.has(key) && !(key in result)) {
        result[key] = value
      }
    }

    return result
  },

  wrapOutputSchema(schema: z.ZodType): Record<string, unknown> {
    return {
      // OpenAI's `zodResponseFormat` helper ships with its own bundled Zod
      // typings — cross-version `z.ZodType` shapes don't structurally align,
      // so we widen at the boundary.
      response_format: zodResponseFormat(schema as Parameters<typeof zodResponseFormat>[0], 'output'),
    }
  },
}

// ─────────────────────────────────────────────────────────────────
// createOpenAI()
// ─────────────────────────────────────────────────────────────────

/**
 * Create an OpenAI adapter bound to a client instance.
 *
 * Returns a `CruxAdapter` with `generate()`, `stream()`, and agent
 * composition methods (parallel, pipeline, consensus, swarm).
 *
 * @example
 * ```ts
 * const openai = createOpenAI(new OpenAI({ apiKey: '...' }))
 * const result = await openai.generate(myPrompt, { model: 'gpt-4o', input: { ... } })
 * result.text   // extracted text
 * result.raw    // raw ChatCompletion
 * result._meta  // normalized usage, finish reason, etc.
 * ```
 */
export const createOpenAI = adapter(openaiSpec)

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

// ─────────────────────────────────────────────────────────────────
// Framework-agnostic adapters
// ─────────────────────────────────────────────────────────────────

/**
 * Create a `GenerateObjectFn` that wraps an OpenAI client.
 *
 * Use this when calling `@crux/core` APIs that expect a `GenerateObjectFn`
 * (e.g., `llmJudge().score()`, `extractKeyFacts()`).
 *
 * This is a provider-native helper: it sends the supplied schema to OpenAI's
 * structured parse surface, returns the parsed `{ object }`, and preserves
 * provider errors. It does not run Crux prompt resolution, validation retry,
 * safety, cassettes, tools, memory, or instrumentation. Use
 * `createGenerateObjectFnFromGenerate(generate)` from `@crux/core/compaction`
 * when the helper call must go through full adapter prompt execution.
 *
 * @example
 * ```ts
 * import { createGenerateObjectFn } from '@crux/openai'
 * import OpenAI from 'openai'
 *
 * const client = new OpenAI({ apiKey: '...' })
 * const generateObjectFn = createGenerateObjectFn(client, 'gpt-4o')
 * const result = await judge.score(input, { generate: generateObjectFn })
 * ```
 */
export function createGenerateObjectFn(client: OpenAI, model: string): GenerateObjectFn {
  return async (options) => {
    const messages: OpenAI.ChatCompletionMessageParam[] = []
    if (options.system) messages.push({ role: 'system', content: options.system })
    messages.push({ role: 'user', content: options.prompt })

    const result = await client.chat.completions.parse({
      model,
      messages,
      response_format: zodResponseFormat(options.schema as Parameters<typeof zodResponseFormat>[0], 'output'),
    })

    const parsed = result.choices[0]?.message?.parsed
    if (!parsed) throw new Error('OpenAI returned no parsed output')
    return { object: parsed }
  }
}

/**
 * Create a `GenerateTextFn` that wraps an OpenAI client.
 *
 * @example
 * ```ts
 * import { createGenerateTextFn } from '@crux/openai'
 * const generateTextFn = createGenerateTextFn(client, 'gpt-4o-mini')
 * await compactConversation({ generate: generateTextFn, ... })
 * ```
 */
export function createGenerateTextFn(client: OpenAI, model: string): GenerateTextFn {
  return async (options) => {
    const messages: OpenAI.ChatCompletionMessageParam[] = []
    if (options.system) messages.push({ role: 'system', content: options.system })
    messages.push({ role: 'user', content: options.prompt })

    const result = await client.chat.completions.create({ model, messages })
    return { text: result.choices[0]?.message?.content ?? '' }
  }
}
