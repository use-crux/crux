import type { ExecutorStreamHandle, ExecutorStreamMeta } from '@use-crux/core/adapter'
import { withLegacyStreamMeta } from './stream-meta'
import type { CachedStreamPayload, SdkStreamResultLike } from './types'

/**
 * Recreate an SDK-shaped stream handle from a cached semantic-cache payload.
 *
 * The replayed handle yields text chunks, preserves structured objects when
 * present, and marks completion metadata with `semanticCache.replay`.
 *
 * @internal
 */
export function replayStream(cached: CachedStreamPayload): ExecutorStreamHandle<SdkStreamResultLike> {
  const text = cached.text ?? (cached.object !== undefined ? JSON.stringify(cached.object) : '')
  const cachedMeta = (cached.meta ?? {}) as Record<string, unknown>
  const existingSemanticCache = (cachedMeta.semanticCache as Record<string, unknown> | undefined) ?? {}
  const completionMeta: ExecutorStreamMeta = {
    ...(cachedMeta as ExecutorStreamMeta),
    text,
    semanticCache: { ...existingSemanticCache, replay: true },
  } as ExecutorStreamMeta

  function* chunkText(): Generator<string> {
    for (let index = 0; index < text.length; index += 64) {
      yield text.slice(index, index + 64)
    }
  }
  async function* textIterator(): AsyncGenerator<string> {
    yield* chunkText()
  }

  const completionPromise = Promise.resolve(completionMeta)
  const raw: SdkStreamResultLike = {
    ...(cached.object !== undefined ? { object: Promise.resolve(cached.object) } : {}),
    text: Promise.resolve(text),
    textStream: textIterator(),
    fullStream: textIterator(),
    _meta: { ...cachedMeta, _streamCompletion: completionPromise },
  }
  return withLegacyStreamMeta({ raw, completion: () => completionPromise }, completionPromise)
}
