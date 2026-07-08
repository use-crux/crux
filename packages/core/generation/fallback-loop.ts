/**
 * Generic model fallback loop for adapter packages.
 *
 * Tries each model in a {@link FallbackModel} wrapper in order, classifying
 * failures, emitting per-attempt routing spans/reports, and attaching
 * `_meta.fallback` metadata to the first successful result when earlier attempts
 * failed. The adapter supplies only the per-model execution and a model-id
 * extractor.
 *
 * @module
 * @internal
 */

import { observe } from '../observability'
import { withBudget } from './timeout'
import type { FallbackModel, FallbackMeta, FallbackAttemptDetail } from './fallback'
import { classifyError, shouldAttemptFallback } from './fallback'
import { getMeta, setMeta } from './result-meta'

/** Options supplied to one fallback model attempt. */
export interface FallbackTryOptions {
  /**
   * Cooperative cancellation signal for the current fallback attempt.
   *
   * Adapters should pass this to the underlying provider call when supported.
   * The loop still races the timeout itself, so providers that ignore the
   * signal cannot block fallback progress.
   */
  readonly signal?: AbortSignal
}

/**
 * Generic fallback loop for adapter packages. Tries each model in order,
 * tracking per-attempt timing, error classification, and cost. Attaches
 * `_meta.fallback` metadata on the successful result when prior attempts failed.
 *
 * @param fb - A `FallbackModel` wrapper created by `fallback(modelA, modelB, ...)`
 * @param tryModel - Adapter-specific callback that executes a single model attempt.
 *   Receives the model and per-attempt options, including the cooperative
 *   timeout signal, and returns the SDK result with `_meta` attached.
 * @param extractModelId - Extracts a human-readable model identifier from the
 *   adapter's model type (e.g., `(m) => m` for string models, `(m) => m.modelId` for AI SDK)
 * @returns The result from the first successful model, with `_meta.fallback`
 *   populated when fallback occurred
 * @throws {AggregateError} When all models fail
 *
 * @example
 * ```ts
 * // Inside an adapter's generate():
 * if (isFallback(opts.model)) {
 *   return executeFallbackLoop(
 *     opts.model,
 *     (model) => this.generate(prompt, { ...opts, model }),
 *     (model) => model, // string model IDs
 *   )
 * }
 * ```
 */
export async function executeFallbackLoop<M, R>(
  fb: FallbackModel<M>,
  tryModel: (model: M, options: FallbackTryOptions) => Promise<R>,
  extractModelId: (model: M) => string,
): Promise<R> {
  const { models, options: fallbackOpts } = fb
  const errors: Error[] = []
  const details: FallbackAttemptDetail[] = []
  let previousFailedSpanId: ReturnType<typeof observe.openSpan>['spanId'] | undefined
  let previousFailedModelId: string | undefined

  for (let i = 0; i < models.length; i++) {
    const model = models[i]
    const modelId = extractModelId(model)
    const attemptStart = Date.now()
    const attemptSpan = observe.openSpan({
      name: 'fallback.attempt',
      primitive: 'fallback.attempt',
      attributes: {
        attempt: i + 1,
        ...(fallbackOpts.id ? { routingId: fallbackOpts.id } : {}),
        ...(fallbackOpts.description ? { routingDescription: fallbackOpts.description } : {}),
        model: modelId,
        totalModels: models.length,
        hasTimeout: fallbackOpts.timeout !== undefined,
      },
    })

    try {
      const result = await attemptSpan.withContext(() =>
        withBudget((signal) => tryModel(model, { signal }), { budget: 'step', limitMs: fallbackOpts.timeout }),
      )
      const durationMs = Date.now() - attemptStart

      details.push({
        model: modelId,
        durationMs,
        status: 'success',
        cost: getMeta(result)?.cost,
      })

      // Only attach fallback meta if there were failed attempts
      if (errors.length > 0) {
        setMeta(result, {
          fallback: {
            attempts: i + 1,
            failedModels: details.filter((d) => d.status === 'error').map((d) => d.model),
            details,
          } satisfies FallbackMeta,
        })
      }

      if (previousFailedSpanId && previousFailedModelId) {
        observe.edge({
          edgeType: 'fallback.attempt',
          from: { kind: 'span', id: previousFailedSpanId },
          to: { kind: 'span', id: attemptSpan.spanId },
          attributes: {
            fromModel: previousFailedModelId,
            toModel: modelId,
            attempt: i + 1,
          },
        })
      }
      emitFallbackRoutingReport(attemptSpan.spanId, {
        kind: 'routing.report',
        routingKind: 'fallback',
        ...(fallbackOpts.id ? { routingId: fallbackOpts.id } : {}),
        chosen: modelId,
        tiers: details.map(fallbackTierPreview),
      })
      attemptSpan.end({
        attributes: {
          attempt: i + 1,
          ...(fallbackOpts.id ? { routingId: fallbackOpts.id } : {}),
          model: modelId,
          totalModels: models.length,
          attemptStatus: 'success',
          durationMs,
          cost: getMeta(result)?.cost,
          fallbackOccurred: errors.length > 0,
        },
      })
      return result
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      const durationMs = Date.now() - attemptStart
      const errorCategory = classifyError(err)
      const willAttemptFallback = shouldAttemptFallbackSafely(err, fallbackOpts, attemptSpan)

      details.push({
        model: modelId,
        durationMs,
        status: 'error',
        error: err.message,
        errorCategory,
      })

      // Check if this error should trigger fallback
      if (!willAttemptFallback) {
        emitFallbackRoutingReport(attemptSpan.spanId, {
          kind: 'routing.report',
          routingKind: 'fallback',
          ...(fallbackOpts.id ? { routingId: fallbackOpts.id } : {}),
          fallbackReason: errorCategory,
          tiers: details.map(fallbackTierPreview),
        })
        attemptSpan.error(err, {
          attempt: i + 1,
          ...(fallbackOpts.id ? { routingId: fallbackOpts.id } : {}),
          model: modelId,
          totalModels: models.length,
          attemptStatus: 'error',
          errorCategory,
          willAttemptFallback: false,
          durationMs,
        })
        throw err
      }

      errors.push(err)
      emitFallbackRoutingReport(attemptSpan.spanId, {
        kind: 'routing.report',
        routingKind: 'fallback',
        ...(fallbackOpts.id ? { routingId: fallbackOpts.id } : {}),
        fallbackReason: errorCategory,
        tiers: details.map(fallbackTierPreview),
      })
      attemptSpan.error(err, {
        attempt: i + 1,
        ...(fallbackOpts.id ? { routingId: fallbackOpts.id } : {}),
        model: modelId,
        totalModels: models.length,
        attemptStatus: 'error',
        errorCategory,
        willAttemptFallback: i < models.length - 1,
        durationMs,
      })
      previousFailedSpanId = attemptSpan.spanId
      previousFailedModelId = modelId
      notifyAttemptErrorSafely(fallbackOpts, err, i + 1, model, attemptSpan)
    }
  }

  throw new AggregateError(errors, `All ${models.length} fallback models failed`)
}

function notifyAttemptErrorSafely<M>(
  fallbackOpts: FallbackModel<M>['options'],
  err: Error,
  attempt: number,
  model: M,
  attemptSpan: ReturnType<typeof observe.openSpan>,
): void {
  try {
    fallbackOpts.onAttemptError?.(err, attempt, model)
  } catch (hookError) {
    emitRoutingHookError(attemptSpan, 'onAttemptError', hookError)
  }
}

function shouldAttemptFallbackSafely<M>(
  err: Error,
  fallbackOpts: FallbackModel<M>['options'],
  attemptSpan: ReturnType<typeof observe.openSpan>,
): boolean {
  try {
    return shouldAttemptFallback(err, fallbackOpts)
  } catch (hookError) {
    emitRoutingHookError(attemptSpan, 'shouldFallback', hookError)
    return false
  }
}

function emitRoutingHookError(
  span: ReturnType<typeof observe.openSpan>,
  hook: string,
  error: unknown,
): void {
  span.withContext(() => {
    observe.event({
      name: 'routing.hook_error',
      attributes: {
        routingKind: 'fallback',
        hook,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  })
}

function fallbackTierPreview(detail: FallbackAttemptDetail, index: number): Record<string, unknown> {
  return {
    tier: index,
    model: detail.model,
    verdict: detail.status,
    ...(detail.error ? { note: detail.error } : {}),
    ...(detail.cost !== undefined ? { cost: detail.cost } : {}),
    durationMs: detail.durationMs,
  }
}

function emitFallbackRoutingReport(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  preview: Record<string, unknown>,
): void {
  const artifactId = observe.artifact({
    kind: 'routing.report',
    contentType: 'application/json',
    encoding: 'json',
    preview,
    attributes: {
      primitive: 'fallback.attempt',
      routingKind: 'fallback',
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'fallback.attempt', routingKind: 'fallback' },
  })
}
