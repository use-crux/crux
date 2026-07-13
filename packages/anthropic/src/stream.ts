import type Anthropic from '@anthropic-ai/sdk'
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream'
import { classifyProviderHttpError, CruxAdapterError, cruxProviderError } from '@use-crux/core/adapter'
import type { AnthropicParsedMessage } from './response'

/**
 * Edge-safe wrapper around the Anthropic SDK's raw `MessageStream`.
 *
 * The raw stream's async iterator rejects with the SDK's own error types when
 * the underlying connection fails mid-stream (distinct from a `finalMessage()`
 * rejection, which the provider bundle already normalizes separately). This
 * wrapper catches those iteration failures and rethrows a normalized
 * {@link CruxAdapterError} so `textStream` consumers never see raw provider
 * exceptions. It forwards only the two members the provider bundle needs —
 * async iteration and `finalMessage()` — mirroring the OpenAI stream capture.
 */
export class AnthropicChatStream implements AsyncIterable<Anthropic.MessageStreamEvent> {
  readonly #raw: MessageStream

  constructor(raw: MessageStream) {
    this.#raw = raw
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Anthropic.MessageStreamEvent> {
    try {
      for await (const event of this.#raw) {
        yield event
      }
    } catch (error) {
      throw new CruxAdapterError(
        classifyProviderHttpError(error, 'anthropic') ??
          cruxProviderError({
            kind: 'provider-error',
            code: 'anthropic.stream_failed',
            retryable: true,
            message: error instanceof Error ? error.message : error,
          }),
        { cause: error },
      )
    }
  }

  /** Forward to the raw stream's `finalMessage()`; rejection normalization stays with the caller. */
  finalMessage(): Promise<AnthropicParsedMessage> {
    return this.#raw.finalMessage() as Promise<AnthropicParsedMessage>
  }
}

/** Wrap a raw Anthropic `MessageStream` so mid-stream iteration errors are normalized. */
export function createAnthropicStreamCapture(raw: MessageStream): AnthropicChatStream {
  return new AnthropicChatStream(raw)
}
