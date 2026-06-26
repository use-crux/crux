import type { ExecutorStreamHandle, ExecutorStreamMeta } from '@use-crux/core/adapter'
import type { SdkStreamResultLike } from './types'

/**
 * Attach the legacy `_meta._streamCompletion` location to a stream handle
 * and its raw SDK result.
 *
 * Older middleware reads stream completion from the raw result metadata while
 * newer callers use `handle.completion()`. The codec writes both locations so
 * stream consumers and replayed streams share one shape.
 *
 * @internal
 */
export function withLegacyStreamMeta(
  handle: ExecutorStreamHandle<SdkStreamResultLike>,
  completion: Promise<ExecutorStreamMeta | undefined>,
): ExecutorStreamHandle<SdkStreamResultLike> {
  const rawMeta = (handle.raw._meta as Record<string, unknown> | undefined) ?? {}
  handle.raw._meta = { ...rawMeta, _streamCompletion: completion }
  return Object.assign(handle, { _meta: { _streamCompletion: completion } })
}
