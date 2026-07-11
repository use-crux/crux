import type { GenerateContentResponse } from '@google/genai'
import type { TraceMeta } from '@use-crux/core'
import {
  classifyProviderHttpError,
  CruxAdapterError,
  cruxProviderError,
} from '@use-crux/core/adapter'
import { googleUsage, mapGoogleFinishReason } from './response'

/** Extract a text delta from a Google GenAI stream chunk. */
export function googleTextDelta(chunk: unknown): string | undefined {
  if (!isRecord(chunk) || !Array.isArray(chunk.candidates)) return undefined
  const candidate = chunk.candidates[0]
  if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) {
    return undefined
  }
  const firstPart = candidate.content.parts[0]
  if (!isRecord(firstPart)) return undefined
  return typeof firstPart.text === 'string' ? firstPart.text : undefined
}

/**
 * Single-pass Google stream wrapper that captures completion metadata.
 *
 * Google's content stream is single-pass and its usage/finish-reason/model
 * version arrive progressively across chunks (function calls arrive whole in
 * one chunk rather than as incremental argument deltas), so we capture them
 * while the stream is consumed rather than re-reading it after the fact.
 * `finalMeta()` then reports normalized usage/finish-reason/model and the
 * fully assembled — never partial — tool calls. Iteration errors are surfaced
 * as normalized {@link CruxAdapterError}s instead of raw provider exceptions.
 */
export class GoogleChatStream implements AsyncIterable<GenerateContentResponse> {
  readonly #raw: AsyncIterable<GenerateContentResponse>
  #usage: GenerateContentResponse['usageMetadata']
  #finishReason: string | undefined
  #blockReason: string | undefined
  #model: string | undefined
  readonly #toolCalls = new Map<string, { id: string; name: string; args: unknown }>()
  #toolCallCounter = 0

  constructor(raw: AsyncIterable<GenerateContentResponse>) {
    this.#raw = raw
  }

  async *[Symbol.asyncIterator](): AsyncIterator<GenerateContentResponse> {
    try {
      for await (const chunk of this.#raw) {
        this.#observe(chunk)
        yield chunk
      }
    } catch (error) {
      throw new CruxAdapterError(
        classifyProviderHttpError(error, 'google') ??
          cruxProviderError({
            kind: 'provider-error',
            code: 'google.stream_failed',
            retryable: true,
            message: error instanceof Error ? error.message : error,
          }),
        { cause: error },
      )
    }
  }

  /** Normalized completion metadata assembled from the consumed stream. */
  finalMeta(): TraceMeta {
    const usage = googleUsage(this.#usage)
    const toolCalls = [...this.#toolCalls.values()]
    return {
      ...(usage !== undefined ? { usage } : {}),
      finishReason: mapGoogleFinishReason(this.#finishReason, this.#blockReason),
      actualModelId: this.#model,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    }
  }

  #observe(chunk: GenerateContentResponse): void {
    if (!isRecord(chunk)) return
    if (typeof chunk.modelVersion === 'string') this.#model = chunk.modelVersion
    if (isRecord(chunk.usageMetadata)) {
      this.#usage = chunk.usageMetadata as unknown as GenerateContentResponse['usageMetadata']
    }
    const blockReason = (chunk.promptFeedback as { blockReason?: unknown } | undefined)?.blockReason
    if (typeof blockReason === 'string') this.#blockReason = blockReason

    const candidate = Array.isArray(chunk.candidates) ? chunk.candidates[0] : undefined
    if (!isRecord(candidate)) return
    if (typeof candidate.finishReason === 'string') this.#finishReason = candidate.finishReason

    const parts = isRecord(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : []
    this.#observeFunctionCallParts(parts)
  }

  #observeFunctionCallParts(parts: readonly unknown[]): void {
    for (const part of parts) {
      if (!isRecord(part) || !isRecord(part.functionCall)) continue
      const functionCall = part.functionCall
      const name = typeof functionCall.name === 'string' ? functionCall.name : undefined
      if (name === undefined) continue
      const id = typeof functionCall.id === 'string' ? functionCall.id : `tc_${this.#toolCallCounter++}`
      this.#toolCalls.set(id, { id, name, args: functionCall.args })
    }
  }
}

/** Wrap a raw Google content stream so completion metadata can be captured single-pass. */
export function createGoogleStreamCapture(raw: AsyncIterable<GenerateContentResponse>): GoogleChatStream {
  return new GoogleChatStream(raw)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
