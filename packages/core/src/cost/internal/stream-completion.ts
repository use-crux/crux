import type { TraceMeta } from '../../generation/types'

/**
 * Resolve stream completion without eagerly completing Core-step handles.
 *
 * Core-step streams expose `rawStream` or `extractTextDelta`; their completion
 * may depend on public iteration, so cost tracking must never invoke it early.
 */
export function streamCompletionPromise(
  result: unknown,
  meta: TraceMeta | undefined,
): Promise<TraceMeta | undefined> | undefined {
  const legacy = (meta as { _streamCompletion?: unknown } | undefined)?._streamCompletion
  if (legacy && typeof (legacy as PromiseLike<unknown>).then === 'function') {
    return legacy as Promise<TraceMeta | undefined>
  }
  if (!result || typeof result !== 'object') return undefined
  if ('rawStream' in result || 'extractTextDelta' in result) return undefined
  try {
    const completion = Reflect.get(result, 'completion')
    if (typeof completion !== 'function') return undefined
    const value = Reflect.apply(completion, result, []) as unknown
    return value && typeof (value as PromiseLike<unknown>).then === 'function'
      ? (value as Promise<TraceMeta | undefined>)
      : undefined
  } catch {
    return undefined
  }
}
