/**
 * SDK stream iterator interception for progress and completion tracking.
 *
 * Native SDK adapters (OpenAI, Google, Anthropic) hand their raw stream object
 * here so chunks can be observed for devtools progress reporting and completion
 * without wrapping — the original object (and all its SDK methods) is preserved.
 *
 * @module
 * @internal
 */

import type { StreamProgressReporter } from '../runtime/middleware'
import type { TextDeltaExtractor } from './orchestrate-types'
import { TimeoutError, normalizeBudgetMs } from './timeout'

/**
 * Mutate `[Symbol.asyncIterator]` on an SDK stream object to intercept
 * chunks for progress reporting and completion tracking.
 *
 * @remarks
 * Mutates the original object (not a wrapper) so all SDK methods
 * (`.abort()`, `.controller`, `.toReadableStream()`, etc.) are preserved.
 * Used by native SDK adapters (OpenAI, Google, Anthropic). The AI SDK adapter
 * uses `onChunk`/`onFinish` callbacks instead and does not need this.
 *
 * @param stream - The raw SDK stream object (must have `[Symbol.asyncIterator]`)
 * @param progress - Optional progress reporter from devtools (provides `onChunk`, `flush`, `dispose`)
 * @param extractTextDelta - SDK-specific chunk to text delta extractor
 * @param onComplete - Called when the iterator finishes (receives final chunk if available)
 * @param onError - Called on iteration error (receives the error)
 * @param chunkMs - Optional inactivity timeout between chunks.
 */
export function wrapStreamIterable(
  stream: { [Symbol.asyncIterator]: () => AsyncIterator<unknown> },
  progress: StreamProgressReporter | undefined,
  extractTextDelta: TextDeltaExtractor,
  onComplete: (finalChunk?: unknown) => void,
  onError: (err: unknown) => void,
  chunkMs?: number | null,
): void {
  const originalIterFn = stream[Symbol.asyncIterator].bind(stream)
  const normalizedChunkMs = normalizeBudgetMs(chunkMs)

  stream[Symbol.asyncIterator] = function () {
    const iter = originalIterFn()
    return {
      async next() {
        try {
          const result = await nextWithChunkBudget(iter, normalizedChunkMs)
          if (!result.done) {
            const textDelta = extractTextDelta(result.value)
            progress?.onChunk(textDelta ?? undefined)
          } else {
            await progress?.flush()
            onComplete(undefined)
          }
          return result
        } catch (err) {
          progress?.dispose()
          onError(err)
          throw err
        }
      },
      return: iter.return?.bind(iter),
      throw: iter.throw?.bind(iter),
    }
  }
}

async function nextWithChunkBudget(
  iter: AsyncIterator<unknown>,
  chunkMs: number | undefined,
): Promise<IteratorResult<unknown>> {
  if (chunkMs === undefined) return iter.next()

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      iter.next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError({ budget: 'chunk', limitMs: chunkMs })), chunkMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
