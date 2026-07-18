/**
 * Shared generate/stream orchestration for adapter packages.
 *
 * Extracts the cross-cutting concerns that are identical across all adapters:
 * middleware wrapping, hook dispatch (`onGenerate`/`onError`), per-operation
 * timeouts, and span/artifact observability. Each adapter composes these entry
 * points, keeping only SDK-specific code (message conversion, settings mapping,
 * API calls) local.
 *
 * The orchestration concerns are split across focused modules in this domain:
 * - {@link ./orchestrate-types | orchestrate-types} — the adapter boundary contracts;
 * - {@link ./timeout | timeout} — structured timeout budget helpers;
 * - {@link ./result-meta | result-meta} — `_meta` reading and usage attributes;
 * - {@link ./orchestrate-observability | orchestrate-observability} — span/artifact wiring;
 * - {@link ../routing/resolve | routing/resolve} — recursive model-wrapper resolution;
 * - {@link ./stream-interception | stream-interception} — raw SDK stream iteration hooks.
 *
 * @module
 * @internal
 */

import { observe } from '../observability'
import { warnMissingSemanticCachePlugin } from '../cache'
import { getHooks } from '../runtime/runtime'
import type { MiddlewareResult } from '../runtime/types'
import type { AnyPromptConfig } from '../prompt/prompt-types'
import type { OrchestrationSpec } from './orchestrate-types'
import { getMeta, generationUsageAttributes } from './result-meta'
import { withBudget } from './timeout'
import {
  attachStreamObservability,
  emitOperationDeadline,
  generationAttributes,
  generationInputPreview,
  generationOutputPreview,
  linkActiveSpanToArtifact,
  linkResolvedContextArtifacts,
} from './orchestrate-observability'
import { createGenerationPerformanceTracker } from './performance-metrics'
import type { CruxRunId } from '../observability'
import { stampCruxRunId } from './run-id'

// ─────────────────────────────────────────────────────────────────
// orchestrateGenerate
// ─────────────────────────────────────────────────────────────────

/**
 * Shared generate orchestration. Wraps an adapter's SDK-specific `doGenerate`
 * with middleware, timing, and hooks (`onGenerate`/`onError`) — the
 * cross-cutting concerns that are identical across all adapters.
 *
 * @param spec - Orchestration context: prompt metadata, prepared SDK args,
 *   model reference, and input data.
 * @param doGenerate - Adapter-specific generation function. Receives
 *   `preparedArgs` (possibly modified by middleware) and returns the SDK result.
 * @returns The SDK result after hooks have fired.
 *
 * @example
 * ```ts
 * return orchestrateGenerate(
 *   {
 *     promptId: prompt.id,
 *     promptConfig: prompt.config,
 *     preparedArgs: { model: opts.model, messages, settings },
 *     model: opts.model,
 *     input: opts.input ?? {},
 *   },
 *   doGenerate,
 * )
 * ```
 */
export async function orchestrateGenerate<TArgs extends Record<string, unknown>, TResult extends object>(
  spec: OrchestrationSpec<TArgs>,
  doGenerate: (args: TArgs) => Promise<TResult>,
): Promise<TResult & { readonly runId: CruxRunId }> {
  const span = observe.openSpan({
    name: spec.promptId ? `generate ${spec.promptId}` : 'generate',
    primitive: 'generation.call',
    attributes: generationAttributes(spec, 'generate'),
  })
  const performance = createGenerationPerformanceTracker()
  try {
    const result = await span.withContext(async () => {
      emitOperationDeadline(spec.timeout?.totalMs)
      const inputArtifactId = observe.artifact({
        kind: 'messages',
        contentType: 'application/json',
        encoding: 'json',
        preview: generationInputPreview(spec),
      })
      linkActiveSpanToArtifact('consumed', inputArtifactId)
      linkResolvedContextArtifacts(spec.resolved)

      const result = await withBudget(() => orchestrateGenerateInner(spec, doGenerate), {
        budget: 'total',
        limitMs: spec.timeout?.totalMs,
      })
      const meta = getMeta(result)
      const usageAttributes = generationUsageAttributes(meta)
      if (usageAttributes) {
        observe.event({
          name: 'usage.observed',
          attributes: usageAttributes,
        })
      }

      const outputArtifactId = observe.artifact({
        kind: 'output',
        contentType: 'application/json',
        encoding: 'json',
        preview: generationOutputPreview(result),
      })
      linkActiveSpanToArtifact('produced', outputArtifactId)
      return result
    })
    span.end({ metrics: performance.metrics(getMeta(result)) })
    return { ...result, runId: span.runId }
  } catch (error) {
    span.error(error)
    throw error
  }
}

async function orchestrateGenerateInner<TArgs extends Record<string, unknown>, TResult>(
  spec: OrchestrationSpec<TArgs>,
  doGenerate: (args: TArgs) => Promise<TResult>,
): Promise<TResult> {
  const middleware = getHooks().middleware
  const start = Date.now()
  maybeWarnMissingSemanticCache(spec)

  try {
    let result: TResult
    if (middleware) {
      result = (await middleware(
        {
          promptId: spec.promptId,
          preparedArgs: spec.preparedArgs,
          operation: 'generate',
          promptConfig: spec.promptConfig as AnyPromptConfig,
          input: spec.input,
          provider: spec.provider,
          model: spec.model,
          resolved: spec.resolved,
          outputMode: spec.outputMode,
        },
        async (mArgs) => (await doGenerate(mArgs.preparedArgs as TArgs)) as unknown as MiddlewareResult,
      )) as unknown as TResult
    } else {
      result = await doGenerate(spec.preparedArgs)
    }

    const durationMs = Date.now() - start

    // Fire onGenerate hook — `TResult` is erased at this boundary; the typed
    // hook signature on `AnyPromptConfig` lives in user-defined prompts.
    if (spec.promptConfig.hooks?.onGenerate) {
      spec.promptConfig.hooks.onGenerate(
        { promptId: spec.promptId, durationMs },
        result as unknown as Parameters<NonNullable<typeof spec.promptConfig.hooks.onGenerate>>[1],
      )
    }

    return result
  } catch (error) {
    if (spec.promptConfig.hooks?.onError) {
      spec.promptConfig.hooks.onError({ promptId: spec.promptId, error })
    }
    throw error
  }
}

// ─────────────────────────────────────────────────────────────────
// orchestrateStream
// ─────────────────────────────────────────────────────────────────

/**
 * Shared stream orchestration. Wraps an adapter's SDK-specific `doStream`
 * with middleware and error hook dispatch.
 *
 * @remarks
 * Unlike `orchestrateGenerate`, this does NOT fire `onGenerate`. Stream
 * orchestration handles middleware wrapping and `onError` hook dispatch.
 *
 * @param spec - Orchestration context (subset of generate spec)
 * @param doStream - Adapter-specific streaming function
 * @returns The SDK stream result
 */
export async function orchestrateStream<TArgs extends Record<string, unknown>, TResult extends object>(
  spec: Pick<
    OrchestrationSpec<TArgs>,
    | 'promptId'
    | 'promptConfig'
    | 'preparedArgs'
    | 'input'
    | 'provider'
    | 'model'
    | 'traceModel'
    | 'resolved'
    | 'outputMode'
    | 'createCachedStreamResult'
    | 'timeout'
  >,
  doStream: (args: TArgs) => Promise<TResult>,
): Promise<TResult & { readonly runId: CruxRunId }> {
  const span = observe.openSpan({
    name: spec.promptId ? `stream ${spec.promptId}` : 'stream',
    primitive: 'generation.stream',
    attributes: generationAttributes(spec, 'stream'),
  })
  const performance = createGenerationPerformanceTracker()
  try {
    return await span.withContext(async () => {
      emitOperationDeadline(spec.timeout?.totalMs)
      const inputArtifactId = observe.artifact({
        kind: 'messages',
        contentType: 'application/json',
        encoding: 'json',
        preview: generationInputPreview(spec),
      })
      linkActiveSpanToArtifact('consumed', inputArtifactId)
      linkResolvedContextArtifacts(spec.resolved)
      const result = await withBudget(() => orchestrateStreamInner(spec, doStream), {
        budget: 'total',
        limitMs: spec.timeout?.totalMs,
      })
      attachStreamObservability(result, span, performance, spec.timeout?.chunkMs)
      return stampCruxRunId(result, span.runId)
    })
  } catch (error) {
    span.error(error)
    throw error
  }
}

async function orchestrateStreamInner<TArgs extends Record<string, unknown>, TResult>(
  spec: Pick<
    OrchestrationSpec<TArgs>,
    | 'promptId'
    | 'promptConfig'
    | 'preparedArgs'
    | 'input'
    | 'provider'
    | 'model'
    | 'resolved'
    | 'outputMode'
    | 'createCachedStreamResult'
  >,
  doStream: (args: TArgs) => Promise<TResult>,
): Promise<TResult> {
  const middleware = getHooks().middleware
  maybeWarnMissingSemanticCache(spec)

  try {
    if (middleware) {
      // Middleware is transparent — passes the result through from next()
      return (await middleware(
        {
          promptId: spec.promptId,
          preparedArgs: spec.preparedArgs,
          operation: 'stream',
          promptConfig: spec.promptConfig as AnyPromptConfig,
          input: spec.input,
          provider: spec.provider,
          model: spec.model,
          resolved: spec.resolved,
          outputMode: spec.outputMode,
          createCachedStreamResult: spec.createCachedStreamResult,
        },
        async (mArgs) => (await doStream(mArgs.preparedArgs as TArgs)) as unknown as MiddlewareResult,
      )) as unknown as TResult
    }
    return await doStream(spec.preparedArgs)
  } catch (error) {
    if (spec.promptConfig.hooks?.onError) {
      spec.promptConfig.hooks.onError({ promptId: spec.promptId, error })
    }
    throw error
  }
}

function maybeWarnMissingSemanticCache(
  spec: Pick<OrchestrationSpec<Record<string, unknown>>, 'promptId' | 'promptConfig'>,
): void {
  const semantic = (spec.promptConfig as { cache?: { semantic?: unknown } }).cache?.semantic
  if (semantic !== undefined && semantic !== false && !getHooks().semanticCacheInstalled) {
    warnMissingSemanticCachePlugin(spec.promptId)
  }
}
