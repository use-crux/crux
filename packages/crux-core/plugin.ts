/**
 * Plugin system for composable runtime hook installation.
 *
 * Plugins receive the current runtime state and return a partial patch
 * that is merged using fan-out semantics (all handlers called) for hooks
 * and layered chaining for middleware (new wraps old).
 *
 * @module
 */

import type { CruxRuntime } from './runtime'
import type { InstrumentationHooks, ResolveHook, ResolveHookArgs, StreamProgressReporter } from './middleware'
import type { PromptMiddleware } from './types'

// ─────────────────────────────────────────────────────────────────
// Plugin interface
// ─────────────────────────────────────────────────────────────────

/**
 * Result returned by a plugin's `install()` method.
 *
 * Contains partial runtime fields to merge plus an optional `dispose`
 * function for cleanup when the registry is torn down.
 */
export interface CruxPluginResult extends Partial<CruxRuntime> {
  /** Called when the plugin is uninstalled (registry.dispose()). */
  dispose?: () => void
}

/**
 * A composable plugin that hooks into the Crux runtime.
 *
 * Plugins are installed in order via `config({ plugins: [...] })`.
 * Each plugin's `install()` receives the cumulative runtime from all
 * prior plugins, enabling layered composition.
 *
 * @example
 * ```ts
 * import type { CruxPlugin } from '@crux/core'
 *
 * const myPlugin: CruxPlugin = {
 *   name: 'my-tracer',
 *   install(runtime) {
 *     return {
 *       instrumentationHooks: {
 *         onToolStart: (e) => console.log('tool:', e.toolName),
 *       },
 *       dispose: () => console.log('cleanup'),
 *     }
 *   },
 * }
 * ```
 */
export interface CruxPlugin {
  /** Unique plugin name for debugging and error messages. */
  readonly name: string
  /**
   * Install the plugin. Receives the cumulative runtime (including
   * hooks from prior plugins). Returns runtime fields to merge.
   *
   * @param runtime - Frozen snapshot of the current cumulative runtime.
   * @returns Partial runtime patch with optional dispose function.
   */
  install(runtime: Readonly<CruxRuntime>): CruxPluginResult
}

// ─────────────────────────────────────────────────────────────────
// mergeRuntime — fan-out hooks, layered middleware
// ─────────────────────────────────────────────────────────────────

/**
 * Merge a partial runtime patch into a base runtime.
 *
 * - **Hooks** (executionHook, resolveHook, streamStartHook,
 *   evalReporter, flowEvalReporter): Fan-out — both base and patch handlers
 *   are called for every event.
 * - **Middleware**: Layered chaining — patch middleware wraps base middleware.
 * - **streamProgressHook**: Fan-out — both reporters receive chunks.
 * - **instrumentationHooks**: Per-hook fan-out for all 15 sub-hooks.
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

  if (patch.evalReporter !== undefined) {
    result.evalReporter = fanOutEvalReporter(base.evalReporter, patch.evalReporter)
  }

  if (patch.ragEvalReporter !== undefined) {
    result.ragEvalReporter = fanOutRagEvalReporter(base.ragEvalReporter, patch.ragEvalReporter)
  }

  if (patch.flowEvalReporter !== undefined) {
    result.flowEvalReporter = fanOutFlowEvalReporter(base.flowEvalReporter, patch.flowEvalReporter)
  }

  // Instrumentation hooks: per-hook fan-out
  if (patch.instrumentationHooks !== undefined) {
    result.instrumentationHooks = mergeInstrumentationHooks(base.instrumentationHooks, patch.instrumentationHooks)
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
// applyPlugins
// ─────────────────────────────────────────────────────────────────

/** Result of applying plugins — the merged runtime and a combined dispose function. */
export interface ApplyPluginsResult {
  /** The merged runtime after all plugins have been applied. */
  runtime: CruxRuntime
  /** Dispose all plugins in reverse order. */
  dispose: () => void
}

/**
 * Apply an ordered list of plugins to an initial runtime.
 *
 * Each plugin's `install()` receives the cumulative runtime from all
 * prior plugins. Results are merged using {@link mergeRuntime}.
 * Dispose functions are collected and called in reverse order.
 *
 * @param plugins - Ordered list of plugins to apply.
 * @param initialRuntime - The base runtime before any plugins.
 * @returns The final merged runtime and a combined dispose function.
 *
 * @example
 * ```ts
 * const { runtime, dispose } = applyPlugins(
 *   [withDevtools({ serverUrl }), withTelemetry({ serviceName: 'app' })],
 *   getRuntime(),
 * )
 * setRuntime(runtime)
 * // later: dispose()
 * ```
 */
export function applyPlugins(plugins: ReadonlyArray<CruxPlugin>, initialRuntime: CruxRuntime): ApplyPluginsResult {
  const disposeFns: Array<() => void> = []
  let runtime = { ...initialRuntime }

  for (const plugin of plugins) {
    const { dispose, ...patch } = plugin.install(Object.freeze({ ...runtime }))
    runtime = mergeRuntime(runtime, patch)
    if (dispose) {
      disposeFns.push(dispose)
    }
  }

  return {
    runtime,
    dispose() {
      // Reverse order: last installed → first disposed
      for (let i = disposeFns.length - 1; i >= 0; i--) {
        disposeFns[i]()
      }
    },
  }
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

/**
 * Fan-out eval reporters: both called for each event.
 */
function fanOutEvalReporter(
  base: CruxRuntime['evalReporter'],
  patch: NonNullable<CruxRuntime['evalReporter']>,
): NonNullable<CruxRuntime['evalReporter']> {
  if (!base) return patch
  return {
    onStart(info) {
      base.onStart?.(info)
      patch.onStart?.(info)
    },
    onCase(result) {
      base.onCase?.(result)
      patch.onCase?.(result)
    },
    onEnd(info) {
      base.onEnd?.(info)
      patch.onEnd?.(info)
    },
  }
}

/**
 * Fan-out RAG eval reporters: both called for each event.
 */
function fanOutRagEvalReporter(
  base: CruxRuntime['ragEvalReporter'],
  patch: NonNullable<CruxRuntime['ragEvalReporter']>,
): NonNullable<CruxRuntime['ragEvalReporter']> {
  if (!base) return patch
  return {
    onStart(info) {
      base.onStart?.(info)
      patch.onStart?.(info)
    },
    onCase(result) {
      base.onCase?.(result)
      patch.onCase?.(result)
    },
    onEnd(info) {
      base.onEnd?.(info)
      patch.onEnd?.(info)
    },
  }
}

/**
 * Fan-out flow eval reporters: both called for each event.
 */
function fanOutFlowEvalReporter(
  base: CruxRuntime['flowEvalReporter'],
  patch: NonNullable<CruxRuntime['flowEvalReporter']>,
): NonNullable<CruxRuntime['flowEvalReporter']> {
  if (!base) return patch
  return {
    onStart(info) {
      base.onStart?.(info)
      patch.onStart?.(info)
    },
    onCase(result) {
      base.onCase?.(result)
      patch.onCase?.(result)
    },
    onEnd(info) {
      base.onEnd?.(info)
      patch.onEnd?.(info)
    },
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
