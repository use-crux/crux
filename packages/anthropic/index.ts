/**
 * `@crux/anthropic` — Anthropic SDK adapter.
 *
 * Built on `adapter()` from `@crux/core/adapter`. Provides `createAnthropic()`
 * factory that returns a `CruxAdapter` with `generate()`, `stream()`, plus
 * agent composition methods (parallel, pipeline, consensus, swarm).
 *
 * @example
 * ```ts
 * import { prompt } from '@crux/core'
 * import { createAnthropic } from '@crux/anthropic'
 * import Anthropic from '@anthropic-ai/sdk'
 *
 * const anthropic = createAnthropic(new Anthropic({ apiKey: '...' }))
 *
 * const result = await anthropic.generate(myPrompt, {
 *   model: 'claude-sonnet-4-5-20250929',
 *   input: { instruction: 'Fix typos' },
 * })
 * ```
 *
 * @module
 */

// Note: this package intentionally stays generation-only. Anthropic's direct
// SDK adapter here does not expose a Crux embedding helper; pair it with
// `embedding()` from @crux/ai or another embedding provider for retrieval/indexing.

import type Anthropic from '@anthropic-ai/sdk'
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { GenerationSettings } from '@crux/core'
import type { GenerateObjectFn, GenerateTextFn } from '@crux/core/compaction'
import { adapter } from '@crux/core/adapter'
import type { AdapterSpec, CallArgs, AdapterResponse, StreamHandle, ToolResultEntry } from '@crux/core/adapter'
import { fromMessages } from './message-codec'

export { fromMessages, toMessages } from './message-codec'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** Provider-specific extra options for Anthropic adapter. */
export interface AnthropicExtra extends Record<string, unknown> {
  /** Anthropic tool definitions for function calling (bypass Crux tool conversion). */
  tools?: Anthropic.ToolUnion[]
  /** Tool choice strategy. */
  tool_choice?: Anthropic.ToolChoice
}

// ─────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────

/** Default max_tokens when not provided (Anthropic requires this field). */
const DEFAULT_MAX_TOKENS = 4096

/** Maximum cache_control breakpoints Anthropic supports. */
const MAX_CACHE_BREAKPOINTS = 4

/** Extract text from an Anthropic Message's content blocks. */
function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

function asAnthropicNonStreamingParams(params: Record<string, unknown>): Anthropic.MessageCreateParamsNonStreaming {
  return params as unknown as Anthropic.MessageCreateParamsNonStreaming
}

function asAnthropicStreamingParams(params: Record<string, unknown>): Anthropic.MessageCreateParamsStreaming {
  return params as unknown as Anthropic.MessageCreateParamsStreaming
}

/**
 * Strip `description` fields from a JSON schema (deeply).
 * Anthropic rejects tool parameter schemas that contain descriptions.
 */
function stripDescriptions(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'description') continue
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = stripDescriptions(value as Record<string, unknown>)
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? stripDescriptions(item as Record<string, unknown>)
          : item,
      )
    } else {
      result[key] = value
    }
  }
  return result
}

// ─────────────────────────────────────────────────────────────────
// AdapterSpec
// ─────────────────────────────────────────────────────────────────

/** Native Anthropic `AdapterSpec`; exported for adapter conformance tests. */
export const anthropicSpec: AdapterSpec<Anthropic, Anthropic.Message, MessageStream, AnthropicExtra> = {
  providerId: 'anthropic',

  async call(client, args: CallArgs<AnthropicExtra>) {
    const messages = fromMessages(args.messages)

    // System message: use systemBlocks with cache_control when available,
    // otherwise fall back to plain string
    let system: string | Anthropic.TextBlockParam[] | undefined
    if (args.systemBlocks?.some((b) => b.providerCache)) {
      let breakpointCount = 0
      system = args.systemBlocks.map((block) => {
        const textBlock: Anthropic.TextBlockParam = { type: 'text', text: block.text }
        if (block.providerCache && breakpointCount < MAX_CACHE_BREAKPOINTS) {
          breakpointCount++
          textBlock.cache_control = { type: 'ephemeral' }
        }
        return textBlock
      })
    } else {
      system = args.system
    }

    // Tools: prefer extra.tools (raw Anthropic format), else convert canonical tools
    const toolParams: Record<string, unknown> = {}
    if (args.extra?.tools && args.extra.tools.length > 0) {
      toolParams.tools = args.extra.tools
    } else if (args.tools && args.tools.length > 0) {
      toolParams.tools = args.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: Object.keys(t.parameters).length > 0 ? t.parameters : { type: 'object' as const, properties: {} },
      }))
    }

    if (args.extra?.tool_choice) {
      toolParams.tool_choice = args.extra.tool_choice
    }

    // Structured output via zodOutputFormat
    const maxTokens = (args.settings.max_tokens as number) ?? DEFAULT_MAX_TOKENS
    const callBody: Record<string, unknown> = {
      model: args.model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages,
      ...toolParams,
      ...args.settings,
    }
    // `messages.parse()` returns `ParsedMessage<T> = Message & { parsed_output: T | null }`.
    // `messages.create()` returns `Message`. Widen the local type to read `parsed_output` safely.
    const result: Anthropic.Message & { parsed_output?: unknown } = args.schemaParams
      ? await client.messages.parse(asAnthropicNonStreamingParams({ ...callBody, ...args.schemaParams }))
      : await client.messages.create(asAnthropicNonStreamingParams(callBody))

    // Extract tool calls from content blocks
    const toolUseBlocks = result.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    const toolCalls =
      toolUseBlocks.length > 0 ? toolUseBlocks.map((b) => ({ id: b.id, name: b.name, args: b.input })) : undefined

    const extracted: AdapterResponse = {
      text:
        result.parsed_output != null
          ? typeof result.parsed_output === 'string'
            ? result.parsed_output
            : JSON.stringify(result.parsed_output)
          : extractText(result),
      toolCalls,
      usage: {
        inputTokens: result.usage.input_tokens ?? 0,
        outputTokens: result.usage.output_tokens ?? 0,
        totalTokens: (result.usage.input_tokens ?? 0) + (result.usage.output_tokens ?? 0),
      },
      finishReason: result.stop_reason ?? undefined,
      responseId: result.id,
      actualModelId: result.model,
    }

    return { raw: result, extracted }
  },

  async stream(client, args: CallArgs<AnthropicExtra>) {
    const messages = fromMessages(args.messages)

    // System message with cache_control support
    let system: string | Anthropic.TextBlockParam[] | undefined
    if (args.systemBlocks?.some((b) => b.providerCache)) {
      let breakpointCount = 0
      system = args.systemBlocks.map((block) => {
        const textBlock: Anthropic.TextBlockParam = { type: 'text', text: block.text }
        if (block.providerCache && breakpointCount < MAX_CACHE_BREAKPOINTS) {
          breakpointCount++
          textBlock.cache_control = { type: 'ephemeral' }
        }
        return textBlock
      })
    } else {
      system = args.system
    }

    // Tools
    const toolParams: Record<string, unknown> = {}
    if (args.extra?.tools && args.extra.tools.length > 0) {
      toolParams.tools = args.extra.tools
    } else if (args.tools && args.tools.length > 0) {
      toolParams.tools = args.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: Object.keys(t.parameters).length > 0 ? t.parameters : { type: 'object' as const, properties: {} },
      }))
    }

    if (args.extra?.tool_choice) {
      toolParams.tool_choice = args.extra.tool_choice
    }

    const streamMaxTokens = (args.settings.max_tokens as number) ?? DEFAULT_MAX_TOKENS
    // doesn't accept open `Record<string, unknown>` spread — see the
    const streamBody: Record<string, unknown> = {
      model: args.model,
      max_tokens: streamMaxTokens,
      ...(system ? { system } : {}),
      messages,
      ...toolParams,
      ...args.settings,
    }
    const rawStream = client.messages.stream(asAnthropicStreamingParams(streamBody))

    return {
      rawStream,
      extractTextDelta: (chunk: unknown) => {
        const c = chunk as { type?: string; delta?: { type?: string; text?: string } } | null | undefined
        return c?.type === 'content_block_delta' && c.delta?.type === 'text_delta' ? c.delta.text : undefined
      },
      completion: async () => {
        try {
          const finalMsg = await rawStream.finalMessage()
          return {
            usage: {
              inputTokens: finalMsg.usage.input_tokens,
              outputTokens: finalMsg.usage.output_tokens,
              totalTokens: finalMsg.usage.input_tokens + finalMsg.usage.output_tokens,
            },
          }
        } catch {
          return undefined
        }
      },
    } as StreamHandle<MessageStream>
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
      // Anthropic tool results use tool role with tool_call_id
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
    result.max_tokens = settings.maxTokens ?? DEFAULT_MAX_TOKENS
    if (settings.topP !== undefined) result.top_p = settings.topP
    if (settings.topK !== undefined) result.top_k = settings.topK
    if (settings.stopSequences !== undefined) result.stop_sequences = settings.stopSequences

    // Pass through any Anthropic-native settings (e.g. thinking, metadata, service_tier)
    // Silently ignore frequencyPenalty/presencePenalty (not supported)
    const KNOWN_KEYS = new Set([
      'temperature',
      'maxTokens',
      'topP',
      'topK',
      'frequencyPenalty',
      'presencePenalty',
      'stopSequences',
    ])
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined && !KNOWN_KEYS.has(key) && !(key in result)) {
        result[key] = value
      }
    }

    return result
  },

  sanitizeToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
    return stripDescriptions(schema)
  },

  wrapOutputSchema(schema: z.ZodType): Record<string, unknown> {
    return {
      // Anthropic's helper ships with its own Zod typings; cross-version
      // `z.ZodType` shapes don't structurally align, so we widen at the
      // boundary.
      output_config: { format: zodOutputFormat(schema as Parameters<typeof zodOutputFormat>[0]) },
    }
  },
}

// ─────────────────────────────────────────────────────────────────
// createAnthropic()
// ─────────────────────────────────────────────────────────────────

/**
 * Create an Anthropic adapter bound to a client instance.
 *
 * Returns a `CruxAdapter` with `generate()`, `stream()`, and agent
 * composition methods (parallel, pipeline, consensus, swarm).
 *
 * @example
 * ```ts
 * const anthropic = createAnthropic(new Anthropic({ apiKey: '...' }))
 * const result = await anthropic.generate(myPrompt, { model: 'claude-sonnet-4-5-20250929', input: { ... } })
 * result.text   // extracted text
 * result.raw    // raw Anthropic.Message
 * result._meta  // normalized usage, finish reason, etc.
 * ```
 */
export const createAnthropic = adapter(anthropicSpec)

// ─────────────────────────────────────────────────────────────────
// Framework-agnostic adapters
// ─────────────────────────────────────────────────────────────────

/**
 * Create a `GenerateObjectFn` that wraps an Anthropic client.
 *
 * Use this when calling `@crux/core` APIs that expect a `GenerateObjectFn`
 * (e.g., `llmJudge().score()`, `extractKeyFacts()`).
 *
 * @example
 * ```ts
 * import { createGenerateObjectFn } from '@crux/anthropic'
 * import Anthropic from '@anthropic-ai/sdk'
 *
 * const client = new Anthropic({ apiKey: '...' })
 * const generateObjectFn = createGenerateObjectFn(client, 'claude-sonnet-4-5-20250929')
 * const result = await judge.score(input, { generate: generateObjectFn })
 * ```
 */
export function createGenerateObjectFn(client: Anthropic, model: string): GenerateObjectFn {
  return async (options) => {
    const messages: Anthropic.MessageParam[] = []
    messages.push({ role: 'user', content: options.prompt })

    const result = await client.messages.parse({
      model,
      ...(options.system ? { system: options.system } : {}),
      messages,
      max_tokens: DEFAULT_MAX_TOKENS,
      output_config: {
        format: zodOutputFormat(options.schema as Parameters<typeof zodOutputFormat>[0]),
      },
    })

    const parsed = result.parsed_output
    if (parsed == null) throw new Error('Anthropic returned no parsed output')
    // Schema is `z.ZodType<T>` (inferred by caller); Anthropic's `parsed_output`
    // is untyped, so widen via the schema's inferred output type — the parser already
    // validated against the schema before returning.
    return { object: parsed as ReturnType<typeof options.schema.parse> }
  }
}

/**
 * Create a `GenerateTextFn` that wraps an Anthropic client.
 *
 * @example
 * ```ts
 * import { createGenerateTextFn } from '@crux/anthropic'
 * const generateTextFn = createGenerateTextFn(client, 'claude-haiku-4-5-20251001')
 * await compactConversation({ generate: generateTextFn, ... })
 * ```
 */
export function createGenerateTextFn(client: Anthropic, model: string): GenerateTextFn {
  return async (options) => {
    const messages: Anthropic.MessageParam[] = []
    messages.push({ role: 'user', content: options.prompt })

    const result = await client.messages.create({
      model,
      ...(options.system ? { system: options.system } : {}),
      messages,
      max_tokens: DEFAULT_MAX_TOKENS,
    })

    return { text: extractText(result) }
  }
}
