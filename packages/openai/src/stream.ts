import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { TraceMeta } from '@use-crux/core'
import {
  classifyProviderHttpError,
  CruxAdapterError,
  cruxProviderError,
} from '@use-crux/core/adapter'
import { mapOpenAIFinishReason, openAIUsage, type OpenAIUsageShape } from './response'

/** Extract a text delta from an OpenAI chat-completion stream chunk. */
export function openAITextDelta(chunk: unknown): string | undefined {
  if (!isRecord(chunk) || !Array.isArray(chunk.choices)) return undefined
  const firstChoice = chunk.choices[0]
  if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) return undefined
  const content = firstChoice.delta.content
  return typeof content === 'string' ? content : undefined
}

/** Compile-time alias used by native chat stream bindings. */
export type OpenAIChatStreamChunk = ChatCompletionChunk

/**
 * Single-pass OpenAI stream wrapper that captures completion metadata.
 *
 * OpenAI's chat stream is single-pass and its usage/finish-reason arrive in the
 * final chunk (and tool-call arguments arrive as deltas across chunks), so we
 * capture them while the stream is consumed rather than re-reading it after the
 * fact. `finalMeta()` then reports normalized usage/finish-reason/model and the
 * fully assembled — never partial — tool calls. Iteration errors are surfaced
 * as normalized {@link CruxAdapterError}s instead of raw provider exceptions.
 */
export class OpenAIChatStream implements AsyncIterable<ChatCompletionChunk> {
  readonly #raw: AsyncIterable<ChatCompletionChunk>
  #usage: OpenAIUsageShape | undefined
  #finishReason: string | undefined
  #model: string | undefined
  #responseId: string | undefined
  readonly #toolCalls = new Map<number, { id?: string; name?: string; args: string }>()

  constructor(raw: AsyncIterable<ChatCompletionChunk>) {
    this.#raw = raw
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk> {
    try {
      for await (const chunk of this.#raw) {
        this.#observe(chunk)
        yield chunk
      }
    } catch (error) {
      throw new CruxAdapterError(
        classifyProviderHttpError(error, 'openai') ??
          cruxProviderError({
            kind: 'provider-error',
            code: 'openai.stream_failed',
            retryable: true,
            message: error instanceof Error ? error.message : error,
          }),
        { cause: error },
      )
    }
  }

  /** Normalized completion metadata assembled from the consumed stream. */
  finalMeta(): TraceMeta {
    const usage = openAIUsage(this.#usage)
    const toolCalls = this.#assembleToolCalls()
    return {
      ...(usage !== undefined ? { usage } : {}),
      finishReason: mapOpenAIFinishReason(this.#finishReason),
      responseId: this.#responseId,
      actualModelId: this.#model,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    }
  }

  #observe(chunk: ChatCompletionChunk): void {
    if (!isRecord(chunk)) return
    if (typeof chunk.model === 'string') this.#model = chunk.model
    if (typeof chunk.id === 'string') this.#responseId = chunk.id
    if (isRecord(chunk.usage)) this.#usage = chunk.usage as unknown as OpenAIUsageShape
    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined
    if (!isRecord(choice)) return
    if (typeof choice.finish_reason === 'string') this.#finishReason = choice.finish_reason
    const delta = choice.delta
    if (isRecord(delta) && Array.isArray(delta.tool_calls)) {
      this.#observeToolCallDeltas(delta.tool_calls)
    }
  }

  #observeToolCallDeltas(deltas: readonly unknown[]): void {
    for (const raw of deltas) {
      if (!isRecord(raw) || typeof raw.index !== 'number') continue
      const current = this.#toolCalls.get(raw.index) ?? { args: '' }
      if (typeof raw.id === 'string') current.id = raw.id
      const fn = raw.function
      if (isRecord(fn)) {
        if (typeof fn.name === 'string') current.name = fn.name
        if (typeof fn.arguments === 'string') current.args += fn.arguments
      }
      this.#toolCalls.set(raw.index, current)
    }
  }

  #assembleToolCalls(): Array<{ id: string; name: string; args: unknown }> {
    const assembled: Array<{ id: string; name: string; args: unknown }> = []
    for (const [index, call] of [...this.#toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
      if (call.name === undefined) continue
      assembled.push({
        id: call.id ?? `call_${index}`,
        name: call.name,
        args: parseArgs(call.args),
      })
    }
    return assembled
  }
}

/** Wrap a raw OpenAI chat stream so completion metadata can be captured single-pass. */
export function createOpenAIStreamCapture(
  raw: AsyncIterable<ChatCompletionChunk>,
): OpenAIChatStream {
  return new OpenAIChatStream(raw)
}

function parseArgs(text: string): unknown {
  if (text.length === 0) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
