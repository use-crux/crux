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
import type { AdapterSpec, CallArgs, StreamHandle } from '@crux/core/adapter'
import { anthropicMessageToolRoundCodec } from './message-codec'
import {
  anthropicMaxTokens,
  anthropicSystemParam,
  anthropicToolParams,
  asAnthropicNonStreamingParams,
  asAnthropicStreamingParams,
  DEFAULT_MAX_TOKENS,
  mapAnthropicSettings,
  stripDescriptions,
} from './request-params'
import { extractAdapterResponse, extractText } from './response'
import type { AnthropicParsedMessage } from './response'

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
// AdapterSpec
// ─────────────────────────────────────────────────────────────────

/** Native Anthropic `AdapterSpec`; exported for adapter conformance tests. */
export const anthropicSpec: AdapterSpec<Anthropic, Anthropic.Message, MessageStream, AnthropicExtra> = {
  providerId: 'anthropic',

  async call(client, args: CallArgs<AnthropicExtra>) {
    const messages = anthropicMessageToolRoundCodec.toAnthropicMessages(args.messages)
    const system = anthropicSystemParam(args.system, args.systemBlocks)
    const settings = { ...args.settings, max_tokens: anthropicMaxTokens(args.settings) }
    const callBody: Record<string, unknown> = {
      model: args.model,
      ...(system ? { system } : {}),
      messages,
      ...anthropicToolParams(args.tools, args.extra),
      ...settings,
    }

    const result: AnthropicParsedMessage = args.schemaParams
      ? await client.messages.parse(asAnthropicNonStreamingParams({ ...callBody, ...args.schemaParams }))
      : await client.messages.create(asAnthropicNonStreamingParams(callBody))
    const extracted = extractAdapterResponse(result)

    return { raw: result, extracted }
  },

  async stream(client, args: CallArgs<AnthropicExtra>) {
    const messages = anthropicMessageToolRoundCodec.toAnthropicMessages(args.messages)
    const system = anthropicSystemParam(args.system, args.systemBlocks)
    const settings = { ...args.settings, max_tokens: anthropicMaxTokens(args.settings) }
    const streamBody: Record<string, unknown> = {
      model: args.model,
      ...(system ? { system } : {}),
      messages,
      ...anthropicToolParams(args.tools, args.extra),
      ...settings,
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
    return anthropicMessageToolRoundCodec.appendToolRound({
      history: messages,
      assistant: assistantResponse,
      toolResults,
    })
  },

  mapSettings(settings: GenerationSettings): Record<string, unknown> {
    return mapAnthropicSettings(settings)
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
 * This is a provider-native helper: it sends the supplied schema to
 * Anthropic's structured parse surface, returns the parsed `{ object }`, and
 * preserves provider errors. It does not run Crux prompt resolution,
 * validation retry, safety, cassettes, tools, memory, or instrumentation. Use
 * `createGenerateObjectFnFromGenerate(generate)` from `@crux/core/compaction`
 * when the helper call must go through full adapter prompt execution.
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
