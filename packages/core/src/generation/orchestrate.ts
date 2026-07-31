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

import { observe, type OperationResultMeta, type WithOperationResultMeta } from '../observability'
import { withOperationResultMeta } from '../observability/internal/result-meta'
import { getHooks } from '../runtime/runtime'
import type { MiddlewareResult } from '../runtime/types'
import type { AnyPromptConfig } from '../prompt/prompt-types'
import type { OrchestrationSpec, StreamOrchestrationSpec } from './orchestrate-types'
import { getMeta, generationUsageAttributes } from './result-meta'
import {
  captureOperationResultMeta,
  createFinalizingMiddlewareNext,
} from '../runtime/internal/middleware-result-finalizer'
import { withBudget } from './timeout'
import {
  attachStreamObservability,
  emitOperationDeadline,
  emitThreadHistoryOverride,
  generationAttributes,
  generationInputPreview,
  generationOutputPreview,
  linkActiveSpanToArtifact,
  linkResolvedContextArtifacts,
} from './orchestrate-observability'
import { createGenerationPerformanceTracker } from './performance-metrics'
import type { CruxRunId } from '../observability'
import { stampCruxRunId } from './run-id'
import { maybeWarnMissingSemanticCache } from './orchestrate-cache'
import {
  attachCachedCandidateFinalizer,
  cachedCandidateFinalizer,
} from '../runtime/internal/cached-candidate-finalizer'
import {
  attachTerminalResultCoordinator,
  createTerminalResultCoordinator,
  finalizeTerminalResult,
} from '../runtime/internal/terminal-result-finalizer'

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
): Promise<WithOperationResultMeta<TResult> & { readonly runId: CruxRunId }> {
  return orchestrateGenerateWithCompletion(spec, doGenerate)
}

/**
 * Run generation with an internal post-result completion boundary.
 *
 * The acceptance callback settles the fully composed middleware result before
 * cache writes, success hooks, usage, and output evidence. The post-output
 * callback preserves lifecycle work that must observe the output artifact.
 *
 * @param spec - Provider-neutral generation orchestration inputs.
 * @param doGenerate - Adapter-owned generation implementation.
 * @param accept - Internal accepted-result publication callback.
 * @param afterOutput - Internal post-output lifecycle callback.
 * @returns The observed result after the completion boundary settles.
 * @internal
 */
export async function orchestrateGenerateWithCompletion<
  TArgs extends Record<string, unknown>,
  TResult extends object,
>(
  spec: OrchestrationSpec<TArgs>,
  doGenerate: (args: TArgs) => Promise<TResult>,
  accept?: (
    result: WithOperationResultMeta<TResult>,
  ) =>
    | WithOperationResultMeta<TResult>
    | void
    | Promise<WithOperationResultMeta<TResult> | void>,
  afterOutput?: (
    result: WithOperationResultMeta<TResult>,
  ) => void | Promise<void>,
): Promise<WithOperationResultMeta<TResult> & { readonly runId: CruxRunId }> {
  const span = observe.openSpan({
    name: spec.promptId ? `generate ${spec.promptId}` : 'generate',
    primitive: 'generation.call',
    attributes: generationAttributes(spec, 'generate'),
  })
  const operation = captureOperationResultMeta(span)
  const performance = createGenerationPerformanceTracker()
  try {
    const result = await span.withContext(async () => {
      const startedAt = Date.now()
      emitOperationDeadline(spec.timeout?.totalMs)
      emitThreadHistoryOverride(spec.threadHistoryOverride)
      const inputArtifactId = observe.artifact({
        kind: 'messages',
        contentType: 'application/json',
        encoding: 'json',
        preview: generationInputPreview(spec),
      })
      linkActiveSpanToArtifact('consumed', inputArtifactId)
      linkResolvedContextArtifacts(spec.resolved)

      const prepared = await withBudget(() => orchestrateGenerateInner(
        spec,
        doGenerate,
        operation,
      ), {
        budget: 'total',
        limitMs: spec.timeout?.totalMs,
      })
      const completed = await accept?.(prepared.result) ?? prepared.result
      const finalized = prepared.terminal
        ? await finalizeTerminalResult(
            prepared.terminal,
            completed as MiddlewareResult,
          ) as WithOperationResultMeta<TResult>
        : completed
      const meta = getMeta(finalized)
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
        preview: generationOutputPreview(finalized),
      })
      linkActiveSpanToArtifact('produced', outputArtifactId)
      await afterOutput?.(finalized)
      if (spec.promptConfig.hooks?.onGenerate) {
        spec.promptConfig.hooks.onGenerate(
          {
            promptId: spec.promptId,
            durationMs: Date.now() - startedAt,
          },
          finalized as unknown as Parameters<
            NonNullable<typeof spec.promptConfig.hooks.onGenerate>
          >[1],
        )
      }
      return finalized
    })
    span.end({ metrics: performance.metrics(getMeta(result)) })
    return stampCruxRunId(result, span.runId)
  } catch (error) {
    if (spec.promptConfig.hooks?.onError) {
      spec.promptConfig.hooks.onError({ promptId: spec.promptId, error })
    }
    span.error(error)
    throw error
  }
}

async function orchestrateGenerateInner<
  TArgs extends Record<string, unknown>,
  TResult extends object,
>(
  spec: OrchestrationSpec<TArgs>,
  doGenerate: (args: TArgs) => Promise<TResult>,
  operation: OperationResultMeta,
): Promise<{
  readonly result: WithOperationResultMeta<TResult>
  readonly terminal?: ReturnType<typeof createTerminalResultCoordinator>
}> {
  const middleware = getHooks().middleware
  maybeWarnMissingSemanticCache(spec)

  let result: TResult
  if (middleware) {
    const next = createFinalizingMiddlewareNext(doGenerate, operation)
    const terminal = createTerminalResultCoordinator()
    attachTerminalResultCoordinator(next, terminal)
    const candidateFinalizer = spec[cachedCandidateFinalizer]
    if (candidateFinalizer) {
      attachCachedCandidateFinalizer(next, candidateFinalizer)
    }
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
      next,
    )) as unknown as TResult
    return {
      result: withOperationResultMeta(result, operation),
      terminal,
    }
  } else {
    result = await doGenerate(spec.preparedArgs)
  }
  return { result: withOperationResultMeta(result, operation) }
}

// orchestrateStream

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
  spec: StreamOrchestrationSpec<TArgs>,
  doStream: (args: TArgs) => Promise<TResult>,
): Promise<WithOperationResultMeta<TResult> & { readonly runId: CruxRunId }> {
  const span = observe.openSpan({
    name: spec.promptId ? `stream ${spec.promptId}` : 'stream',
    primitive: 'generation.stream',
    attributes: generationAttributes(spec, 'stream'),
  })
  const operation = captureOperationResultMeta(span)
  const performance = createGenerationPerformanceTracker()
  try {
    return await span.withContext(async () => {
      emitOperationDeadline(spec.timeout?.totalMs)
      emitThreadHistoryOverride(spec.threadHistoryOverride)
      const inputArtifactId = observe.artifact({
        kind: 'messages',
        contentType: 'application/json',
        encoding: 'json',
        preview: generationInputPreview(spec),
      })
      linkActiveSpanToArtifact('consumed', inputArtifactId)
      linkResolvedContextArtifacts(spec.resolved)
      const result = await withBudget(() => orchestrateStreamInner(spec, doStream, operation), {
        budget: 'total',
        limitMs: spec.timeout?.totalMs,
      })
      const observed = attachStreamObservability(
        result,
        span,
        performance,
        spec.timeout?.chunkMs,
        spec.discardableAttempt === true,
      )
      return stampCruxRunId(observed, span.runId)
    })
  } catch (error) {
    span.error(error)
    throw error
  }
}

async function orchestrateStreamInner<TArgs extends Record<string, unknown>, TResult extends object>(
  spec: StreamOrchestrationSpec<TArgs>,
  doStream: (args: TArgs) => Promise<TResult>,
  operation: OperationResultMeta,
): Promise<WithOperationResultMeta<TResult>> {
  const middleware = getHooks().middleware
  maybeWarnMissingSemanticCache(spec)

  try {
    if (middleware) {
      const next = createFinalizingMiddlewareNext(doStream, operation)
      const candidateFinalizer = spec[cachedCandidateFinalizer]
      if (candidateFinalizer) {
        attachCachedCandidateFinalizer(next, candidateFinalizer)
      }
      const result = (await middleware(
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
        next,
      )) as unknown as TResult
      return withOperationResultMeta(result, operation)
    }
    return withOperationResultMeta(
      await doStream(spec.preparedArgs),
      operation,
    )
  } catch (error) {
    if (spec.promptConfig.hooks?.onError) {
      spec.promptConfig.hooks.onError({ promptId: spec.promptId, error })
    }
    throw error
  }
}
