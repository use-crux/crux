/**
 * Runtime merge semantics for plugin composition.
 *
 * `mergeRuntime()` folds a partial runtime patch (typically a plugin's
 * `install()` result) into a base runtime. Hooks fan out (every handler is
 * called), middleware layers (new wraps old), safety policies concatenate, and
 * last-write-wins fields (observability transport/delivery) overwrite. The
 * private fan-out/chaining helpers live here so `plugin.ts` can stay focused on
 * the plugin contract and `applyPlugins()` orchestration.
 *
 * @module
 */

import type { CruxRuntime } from './runtime'
import type { InstrumentationHooks, ResolveHook, ResolveHookArgs, StreamProgressReporter } from './middleware'
import type { PromptMiddleware } from './types'

/**
 * Merge a partial runtime patch into a base runtime.
 *
 * - **Hooks** (executionHook, resolveHook, streamStartHook): Fan-out — both
 *   base and patch handlers are called for every event.
 * - **Middleware**: Layered chaining — patch middleware wraps base middleware.
 * - **streamProgressHook**: Fan-out — both reporters receive chunks.
 * - **instrumentationHooks**: Per-hook fan-out for all sub-hooks.
 * - **observability transport**: Last-write-wins.
 *
 * @param base - The current runtime state.
 * @param patch - Partial fields to merge in.
 * @returns A new merged runtime (does not mutate inputs).
 *
 * @example
 * ```ts
 * const merged = mergeRuntime(currentRuntime, plugin.install(currentRuntime))
 * ```
 */
export function mergeRuntime(base: CruxRuntime, patch: Partial<CruxRuntime>): CruxRuntime {
  const result: CruxRuntime = { ...base }

  // Middleware: layered chaining (new wraps old)
  if (patch.middleware !== undefined) {
    result.middleware = chainMiddleware(base.middleware, patch.middleware)
  }

  // Fan-out hooks
  if (patch.executionHook !== undefined) {
    result.executionHook = fanOutHook(base.executionHook, patch.executionHook)
  }

  if (patch.resolveHook !== undefined) {
    result.resolveHook = fanOutResolveHook(base.resolveHook, patch.resolveHook)
  }

  if (patch.streamStartHook !== undefined) {
    result.streamStartHook = fanOutHook(base.streamStartHook, patch.streamStartHook)
  }

  if (patch.streamProgressHook !== undefined) {
    result.streamProgressHook = fanOutStreamProgressHook(base.streamProgressHook, patch.streamProgressHook)
  }

  // Instrumentation hooks: per-hook fan-out
  if (patch.instrumentationHooks !== undefined) {
    result.instrumentationHooks = mergeInstrumentationHooks(base.instrumentationHooks, patch.instrumentationHooks)
  }

  // Global safety policies: concat so multiple plugins compose
  if (patch.globalConstraints !== undefined) {
    result.globalConstraints = [...(base.globalConstraints ?? []), ...patch.globalConstraints]
  }

  if (patch.globalGuardrails !== undefined) {
    result.globalGuardrails = [...(base.globalGuardrails ?? []), ...patch.globalGuardrails]
  }

  if ('observabilityTransport' in patch) {
    result.observabilityTransport = patch.observabilityTransport
  }

  if ('observabilityDelivery' in patch) {
    result.observabilityDelivery = patch.observabilityDelivery
  }

  if ('semanticCacheInstalled' in patch) {
    result.semanticCacheInstalled = patch.semanticCacheInstalled
  }

  return result
}

// ─────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Chain middleware: new wraps old (layered).
 * When the new middleware calls `next(args)`, it invokes the old middleware.
 */
function chainMiddleware(base: PromptMiddleware | undefined, patch: PromptMiddleware): PromptMiddleware {
  if (!base) return patch
  return async (args, next) => {
    return patch(args, (innerArgs) => base(innerArgs, next))
  }
}

/**
 * Fan-out two hooks: both called with the same args.
 * Works for any hook with signature `(args) => void | Promise<void>`.
 */
function fanOutHook<T extends (...args: never[]) => unknown>(base: T | undefined, patch: T): T {
  if (!base) return patch
  return ((...args: Parameters<T>) => {
    base(...args)
    return patch(...args)
  }) as T
}

/**
 * Fan-out resolve hooks: both called, last result wins.
 * ResolveHook returns a traceId that needs to propagate.
 */
function fanOutResolveHook(base: ResolveHook | undefined, patch: ResolveHook): ResolveHook {
  if (!base) return patch
  return async (args: ResolveHookArgs) => {
    await base(args)
    return patch(args)
  }
}

/**
 * Fan-out stream progress hooks: both reporters created, onChunk/flush/dispose
 * forwarded to both.
 */
function fanOutStreamProgressHook(
  base: CruxRuntime['streamProgressHook'],
  patch: NonNullable<CruxRuntime['streamProgressHook']>,
): NonNullable<CruxRuntime['streamProgressHook']> {
  if (!base) return patch
  return (traceId: string): StreamProgressReporter | undefined => {
    const r1 = base(traceId)
    const r2 = patch(traceId)
    if (!r1 && !r2) return undefined
    return {
      onChunk(textDelta) {
        r1?.onChunk(textDelta)
        r2?.onChunk(textDelta)
      },
      async flush() {
        await r1?.flush()
        await r2?.flush()
      },
      dispose() {
        r1?.dispose()
        r2?.dispose()
      },
    }
  }
}

/** All keys of InstrumentationHooks that are hook functions. */
const INSTRUMENTATION_HOOK_KEYS: ReadonlyArray<keyof InstrumentationHooks> = [
  'onEmbedStart',
  'onEmbedEnd',
  'onRetrievalStart',
  'onRetrievalEnd',
  'onRetrievalStageStart',
  'onRetrievalStageEnd',
  'onWorkspaceOperation',
  'onIndexStart',
  'onIndexEnd',
  'onCorpusSyncStart',
  'onCorpusSource',
  'onCorpusSyncEnd',
  'onIngestParseStart',
  'onIngestParseEnd',
  'onMemoryRead',
  'onMemoryWrite',
  'onCompactStart',
  'onCompactEnd',
  'onBudgetCheck',
  'onCostReport',
  'onCostWarn',
  'onCostLimit',
  'onBlackboardUpdate',
  'onHandoffPrepare',
  'onJudgeResult',
  'onDelegateStart',
  'onDelegateComplete',
  'onToolStart',
  'onToolEnd',
  'onToolApprovalRequest',
  'onToolApprovalDecision',
  'onSecurityWarning',
  'onCompositionStart',
  'onCompositionAgent',
  'onCompositionEnd',
  'onFlowStart',
  'onFlowEnd',
  'onStepStart',
  'onStepEnd',
  'onContextCacheHit',
  'onContextCacheMiss',
  'onSkillLoad',
  'onSkillCacheHit',
  'onSkillCacheMiss',
  'onSkillResolve',
  'onGuardrailRun',
  'onConstraintCheck',
  'onConstraintRetry',
  'onConstraintViolation',
  'onSemanticCacheLookupStart',
  'onSemanticCacheLookupEnd',
  'onSemanticCacheHit',
  'onSemanticCacheMiss',
  'onSemanticCacheWrite',
  'onSemanticCacheSkip',
  'onSemanticCacheReplayStart',
  'onSemanticCacheReplayEnd',
]

/**
 * Merge instrumentation hooks: per-hook fan-out.
 * Non-overlapping hooks are preserved from both sides.
 */
function mergeInstrumentationHooks(
  base: InstrumentationHooks | undefined,
  patch: InstrumentationHooks,
): InstrumentationHooks {
  if (!base) return { ...patch }

  const merged: InstrumentationHooks = { ...base }

  for (const key of INSTRUMENTATION_HOOK_KEYS) {
    const baseHook = base[key]
    const patchHook = patch[key]
    if (patchHook) {
      if (baseHook) {
        // Fan-out: call both
        ;(merged as Record<string, unknown>)[key] = (event: unknown) => {
          ;(baseHook as (e: unknown) => void)(event)
          ;(patchHook as (e: unknown) => void)(event)
        }
      } else {
        ;(merged as Record<string, unknown>)[key] = patchHook
      }
    }
  }

  return merged
}
