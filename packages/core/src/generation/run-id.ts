import type { CruxRunId } from '../observability'

/** Attach the orchestration-owned ID without replacing a live stream handle. @internal */
export function stampCruxRunId<TResult extends object>(
  result: TResult,
  runId: CruxRunId,
): TResult & { readonly runId: CruxRunId } {
  const existing = Object.getOwnPropertyDescriptor(result, 'runId')
  if (existing && 'value' in existing && existing.value === runId) {
    return result as TResult & { readonly runId: CruxRunId }
  }
  if (!Object.isExtensible(result) || existing !== undefined) {
    const descriptors = Object.getOwnPropertyDescriptors(result)
    delete descriptors.runId
    const clone = Object.create(Object.getPrototypeOf(result)) as object
    Object.defineProperties(clone, descriptors)
    Object.defineProperty(clone, 'runId', {
      value: runId,
      enumerable: true,
    })
    if (!Object.isExtensible(result)) Object.preventExtensions(clone)
    return clone as TResult & { readonly runId: CruxRunId }
  }
  Object.defineProperty(result, 'runId', {
    value: runId,
    enumerable: true,
    configurable: false,
    writable: false,
  })
  return result as TResult & { readonly runId: CruxRunId }
}
