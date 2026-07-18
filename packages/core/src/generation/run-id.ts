import type { CruxRunId } from '../observability'

/** Attach the orchestration-owned ID without replacing a live stream handle. @internal */
export function stampCruxRunId<TResult extends object>(
  result: TResult,
  runId: CruxRunId,
): TResult & { readonly runId: CruxRunId } {
  Object.defineProperty(result, 'runId', {
    value: runId,
    enumerable: true,
    configurable: false,
    writable: false,
  })
  return result as TResult & { readonly runId: CruxRunId }
}
