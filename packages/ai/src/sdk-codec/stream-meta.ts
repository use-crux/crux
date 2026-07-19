import type {
  ExecutorProviderStreamHandle,
  ExecutorStreamCompletionPayload,
} from '@use-crux/core/adapter'
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
  handle: ExecutorProviderStreamHandle<SdkStreamResultLike>,
  completion: Promise<ExecutorStreamCompletionPayload | undefined>,
): ExecutorProviderStreamHandle<SdkStreamResultLike> {
  tryAttachLegacyCompletion(handle.raw, completion)
  return handle
}

function tryAttachLegacyCompletion(
  raw: SdkStreamResultLike,
  completion: Promise<ExecutorStreamCompletionPayload | undefined>,
): void {
  try {
    const existing = Reflect.get(raw, '_meta')
    if (
      existing !== undefined &&
      (typeof existing !== 'object' || existing === null || Array.isArray(existing))
    ) {
      return
    }
    if (
      existing &&
      !Object.isExtensible(existing) &&
      !Object.prototype.hasOwnProperty.call(existing, '_streamCompletion')
    ) {
      return
    }
    const metadata = cloneMetadata(existing ?? {}, completion)
    const descriptor = Object.getOwnPropertyDescriptor(raw, '_meta')
    if (descriptor && 'value' in descriptor) {
      Object.defineProperty(raw, '_meta', { ...descriptor, value: metadata })
      return
    }
    if (descriptor?.set) {
      descriptor.set.call(raw, metadata)
      return
    }
    if (!descriptor && Object.isExtensible(raw)) {
      Object.defineProperty(raw, '_meta', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: metadata,
      })
    }
  } catch {
    // Raw SDK stream objects may be immutable; the public handle remains usable.
  }
}

function cloneMetadata(
  existing: object,
  completion: Promise<ExecutorStreamCompletionPayload | undefined>,
): object {
  const clone = Object.create(Object.getPrototypeOf(existing)) as object
  for (const key of Reflect.ownKeys(existing)) {
    const descriptor = Object.getOwnPropertyDescriptor(existing, key)
    if (!descriptor || key === '_streamCompletion') continue
    Object.defineProperty(clone, key, descriptor)
  }
  const previous = Object.getOwnPropertyDescriptor(existing, '_streamCompletion')
  Object.defineProperty(clone, '_streamCompletion', {
    configurable: previous?.configurable ?? true,
    enumerable: previous?.enumerable ?? true,
    writable: previous && 'writable' in previous ? previous.writable : true,
    value: completion,
  })
  if (!Object.isExtensible(existing)) Object.preventExtensions(clone)
  return clone
}
